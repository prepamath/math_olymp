-- Limite anti-spam, recalculée depuis l'historique des tentatives d'un exercice :
-- réponse directe : 2 essais libres, QCM : 1 essai libre, puis 1 essai après chaque
-- attente (1 min, 30 min, 3 h, 24 h). Après l'attente de 24 h, le cycle recommence.
create or replace function private.etat_tentatives(p_user_id uuid, p_exo_id text, p_type text)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  delais constant interval[] := array[interval '1 minute', interval '30 minutes', interval '3 hours', interval '24 hours'];
  essais_libres constant int := case when p_type = 'qcm' then 1 else 2 end;
  fin_cycle constant int := essais_libres + array_length(delais, 1) - 1;
  erreurs int := 0;
  fin_blocage timestamptz := null;
  tentative record;
begin
  for tentative in
    select created_at, est_correct from public.reponses_eleves
    where user_id = p_user_id and question_id = p_exo_id
    order by created_at, id
  loop
    if tentative.est_correct then
      return jsonb_build_object('resolu', true, 'bloque', false);
    end if;
    if erreurs = fin_cycle then erreurs := 0; end if;
    erreurs := erreurs + 1;
    fin_blocage := case
      when erreurs >= essais_libres then tentative.created_at + delais[erreurs - essais_libres + 1]
    end;
  end loop;

  if fin_blocage > now() then
    return jsonb_build_object('resolu', false, 'bloque', true,
      'secondes_restantes', ceil(extract(epoch from fin_blocage - now()))::int);
  end if;

  if erreurs = fin_cycle then erreurs := 0; end if;
  return jsonb_build_object('resolu', false, 'bloque', false,
    'tentatives_restantes', greatest(essais_libres - erreurs, 1));
end;
$function$;

-- Permet d'afficher le compte à rebours dès l'ouverture d'un exercice.
create or replace function public.etat_exercice(p_exo_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_type text;
begin
  if v_user_id is null then raise exception 'Non connecté'; end if;
  -- Le prof peut tester ses exercices sans limite.
  if auth.jwt() ->> 'email' = 'prof@maths.local' then
    return jsonb_build_object('bloque', false);
  end if;

  select e->>'type' into v_type
  from public.configuration_site cfg,
       jsonb_each(cfg.data) s,
       jsonb_array_elements(s.value->'categories') c,
       jsonb_array_elements(c->'chapitres') ch,
       jsonb_array_elements(ch->'exercices') e
  where cfg.id = 1 and e->>'id' = p_exo_id;

  if v_type is null then return jsonb_build_object('bloque', false); end if;
  return private.etat_tentatives(v_user_id, p_exo_id, v_type);
end;
$function$;

create or replace function public.verifier_reponse_serveur(p_exo_id text, p_reponse_clean text, p_reponse_brute text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  raw_data jsonb;
  sec_key text;
  sec_val jsonb;
  cat jsonb;
  chap jsonb;
  exo jsonb;
  est_ok boolean := false;
  prerequis_ok boolean;
  v_user_id uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_est_prof boolean := v_email = 'prof@maths.local';
  v_identifiant text;
  v_reponse text := left(coalesce(p_reponse_brute, ''), 1000);
  v_etat jsonb;
begin
  if v_user_id is null then raise exception 'Non connecté'; end if;
  v_identifiant := split_part(v_email, '@', 1);

  select data into raw_data from public.configuration_site where id = 1;

  for sec_key, sec_val in select * from jsonb_each(raw_data) loop
    for cat in select * from jsonb_array_elements(sec_val->'categories') loop
      for chap in select * from jsonb_array_elements(cat->'chapitres') loop
        for exo in select * from jsonb_array_elements(chap->'exercices') loop
          if exo->>'id' = p_exo_id then
            -- Un prérequis supprimé ne bloque pas (même règle que chapitreEstComplete).
            if coalesce(chap->>'prerequis', '') <> '' then
              select coalesce(bool_and(exists (
                select 1 from public.reponses_eleves r
                where r.user_id = v_user_id and r.question_id = e->>'id' and r.est_correct
              )), true) into prerequis_ok
              from jsonb_each(raw_data) s,
                   jsonb_array_elements(s.value->'categories') c,
                   jsonb_array_elements(c->'chapitres') ch,
                   jsonb_array_elements(ch->'exercices') e
              where ch->>'id' = chap->>'prerequis';

              if not prerequis_ok then
                return jsonb_build_object('error', 'Prérequis non validé');
              end if;
            end if;

            -- Sérialise les envois simultanés d'un élève, sinon ils passeraient tous le contrôle.
            perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || p_exo_id, 0));

            -- Contrôle avant la correction : un élève bloqué n'apprend rien sur sa réponse.
            if not v_est_prof then
              v_etat := private.etat_tentatives(v_user_id, p_exo_id, exo->>'type');
              if (v_etat->>'bloque')::boolean then
                return jsonb_build_object('bloque', true, 'etat', v_etat);
              end if;
            end if;

            if exo->>'type' = 'latex' then
              -- La réponse brute est normalisée ici : le serveur ne dépend pas du nettoyage du navigateur.
              select exists (
                select 1 from jsonb_array_elements_text(exo->'reponsesValides') as r
                where private.normaliser_reponse(r) = private.normaliser_reponse(v_reponse)
              ) into est_ok;
            elsif exo->>'type' = 'qcm' then
              if (exo->'options'->(p_reponse_clean::int)->>'correct')::boolean = true then
                est_ok := true;
              end if;
            end if;

            insert into public.reponses_eleves (user_id, identifiant_eleve, question_id, reponse_donnee, est_correct)
            values (v_user_id, v_identifiant, p_exo_id, v_reponse, est_ok);

            return jsonb_build_object(
              'est_correct', est_ok,
              'points', (exo->>'points')::int,
              'indice', case when est_ok then null else exo->>'indiceErreur' end,
              'etat', case
                when v_est_prof then jsonb_build_object('bloque', false)
                else private.etat_tentatives(v_user_id, p_exo_id, exo->>'type')
              end
            );
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('error', 'Exercice introuvable');
end;
$function$;

revoke execute on function public.etat_exercice(text) from public, anon;
grant execute on function public.etat_exercice(text) to authenticated;
