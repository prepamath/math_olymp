-- Les élèves n'écrivent plus jamais directement : tout passe par verifier_reponse_serveur.
drop policy if exists "Les élèves peuvent insérer leurs réponses" on public.reponses_eleves;

revoke all on public.reponses_eleves from anon;
revoke all on public.configuration_site from anon;
revoke insert, update, delete, truncate, references, trigger on public.reponses_eleves from authenticated;

-- Schéma non exposé par l'API.
create schema if not exists private;

-- Normalise une réponse LaTeX. Les accolades ne sont retirées qu'autour d'un seul
-- caractère : sinon \frac{1}{23} et \frac{12}{3} deviendraient identiques.
create or replace function private.normaliser_reponse(p_reponse text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  s text := coalesce(p_reponse, '');
  precedent text;
begin
  s := regexp_replace(s, '\\(left|right|mleft|mright)(?![a-zA-Z])', '', 'g');
  s := regexp_replace(s, '\\[,:;! ]', '', 'g');
  s := regexp_replace(s, '\\(cdot|times)(?![a-zA-Z])|\*', '', 'g');
  s := regexp_replace(s, '\\[dt]frac(?![a-zA-Z])', '\\frac', 'g');
  -- En dernier : "\cdot x" collé deviendrait "\cdotx", qui n'est plus reconnu.
  s := regexp_replace(s, '\s+', '', 'g');
  loop
    precedent := s;
    s := regexp_replace(s, '\{([^{}\\])\}', '\1', 'g');
    exit when s = precedent;
  end loop;
  s := regexp_replace(s, '^1\(', '(');
  return lower(s);
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
  v_identifiant text;
  v_reponse text := left(coalesce(p_reponse_brute, ''), 1000);
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
              'indice', case when est_ok then null else exo->>'indiceErreur' end
            );
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('error', 'Exercice introuvable');
end;
$function$;

create or replace function public.charger_site_eleve()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  raw_data jsonb;
  sec_key text;
  sec_val jsonb;
  cat_idx int;
  chap_idx int;
  exo_idx int;
  opt_idx int;
begin
  if auth.uid() is null then
    raise exception 'Non connecté';
  end if;

  select data into raw_data from public.configuration_site where id = 1;
  if raw_data is null then return '{}'::jsonb; end if;

  -- On parcourt tous les exercices pour retirer les solutions avant d'envoyer à l'élève
  for sec_key, sec_val in select * from jsonb_each(raw_data) loop
    if sec_val ? 'categories' then
      for cat_idx in 0 .. coalesce(jsonb_array_length(sec_val->'categories'), 0) - 1 loop
        for chap_idx in 0 .. coalesce(jsonb_array_length(sec_val->'categories'->cat_idx->'chapitres'), 0) - 1 loop
          for exo_idx in 0 .. coalesce(jsonb_array_length(sec_val->'categories'->cat_idx->'chapitres'->chap_idx->'exercices'), 0) - 1 loop
            -- Supprime les réponses LaTeX et l'indice d'erreur
            raw_data := raw_data #- array[sec_key, 'categories', cat_idx::text, 'chapitres', chap_idx::text, 'exercices', exo_idx::text, 'reponsesValides'];
            raw_data := raw_data #- array[sec_key, 'categories', cat_idx::text, 'chapitres', chap_idx::text, 'exercices', exo_idx::text, 'indiceErreur'];
            -- Supprime l'indicateur "correct: true/false" des options QCM
            if (raw_data #> array[sec_key, 'categories', cat_idx::text, 'chapitres', chap_idx::text, 'exercices', exo_idx::text]) ? 'options' then
              for opt_idx in 0 .. jsonb_array_length(raw_data #> array[sec_key, 'categories', cat_idx::text, 'chapitres', chap_idx::text, 'exercices', exo_idx::text, 'options']) - 1 loop
                raw_data := raw_data #- array[sec_key, 'categories', cat_idx::text, 'chapitres', chap_idx::text, 'exercices', exo_idx::text, 'options', opt_idx::text, 'correct'];
              end loop;
            end if;
          end loop;
        end loop;
      end loop;
    end if;
  end loop;

  return raw_data;
end;
$function$;

-- Les fonctions sont exécutables par PUBLIC par défaut.
revoke execute on function public.verifier_reponse_serveur(text, text, text) from public, anon;
revoke execute on function public.charger_site_eleve() from public, anon;
grant execute on function public.verifier_reponse_serveur(text, text, text) to authenticated;
grant execute on function public.charger_site_eleve() to authenticated;
