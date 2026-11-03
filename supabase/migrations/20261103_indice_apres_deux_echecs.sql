-- L'indice d'un exercice n'est envoyé qu'à partir du deuxième essai faux de l'élève.
-- Au premier échec, 'indice_bientot' indique seulement qu'un indice existe.
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
  v_echecs int;
  v_a_indice boolean;
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

            -- Compte l'essai qui vient d'être enregistré.
            select count(*) into v_echecs from public.reponses_eleves
            where user_id = v_user_id and question_id = p_exo_id and not est_correct;
            v_a_indice := coalesce(exo->>'indiceErreur', '') <> '';

            return jsonb_build_object(
              'est_correct', est_ok,
              'points', (exo->>'points')::int,
              'indice', case when not est_ok and v_echecs >= 2 then exo->>'indiceErreur' end,
              'indice_bientot', not est_ok and v_echecs < 2 and v_a_indice,
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
