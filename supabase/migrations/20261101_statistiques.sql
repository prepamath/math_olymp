-- Statistiques anonymes : aucun pseudo ni user_id ne sort de cette fonction.
create or replace function public.statistiques_site()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_resultat jsonb;
begin
  if v_user_id is null then raise exception 'Non connecté'; end if;

  with exos as (
    select e->>'id' as id, coalesce((e->>'points')::int, 0) as points
    from public.configuration_site cfg,
         jsonb_each(cfg.data) s,
         jsonb_array_elements(s.value->'categories') c,
         jsonb_array_elements(c->'chapitres') ch,
         jsonb_array_elements(ch->'exercices') e
    where cfg.id = 1
  ),
  tentatives as (
    select r.id, r.user_id, r.question_id, r.est_correct, r.created_at, x.points
    from public.reponses_eleves r
    join exos x on x.id = r.question_id
    where r.identifiant_eleve <> 'prof'
  ),
  reussites as (
    select distinct user_id, question_id, points from tentatives where est_correct
  ),
  scores as (
    select user_id, sum(points)::int as score from reussites group by user_id
  ),
  classement as (
    select user_id, score, rank() over (order by score desc)::int as rang from scores
  ),
  premiers_essais as (
    select distinct on (user_id, question_id) user_id, question_id, est_correct
    from tentatives
    order by user_id, question_id, created_at, id
  ),
  par_exo as (
    select p.question_id,
           round(100.0 * count(*) filter (where p.est_correct) / count(*))::int as taux,
           (select count(*) from reussites r where r.question_id = p.question_id)::int as resolus
    from premiers_essais p
    group by p.question_id
  )
  select jsonb_build_object(
    'eleves_classes', (select count(*) from scores),
    'exercices_resolus', (select count(*) from reussites),
    'points_distribues', (select coalesce(sum(points), 0) from reussites),
    'mon_rang', (select rang from classement where user_id = v_user_id),
    'podium', coalesce((
      select jsonb_agg(jsonb_build_object('rang', rang, 'score', score, 'moi', moi) order by rang, moi desc)
      from (
        select rang, score, user_id = v_user_id as moi
        from classement
        order by rang, (user_id = v_user_id) desc
        limit 3
      ) t
    ), '[]'::jsonb),
    'exos', coalesce((
      select jsonb_object_agg(question_id, jsonb_build_object('resolus', resolus, 'taux', taux))
      from par_exo
    ), '{}'::jsonb)
  ) into v_resultat;

  return v_resultat;
end;
$function$;

revoke execute on function public.statistiques_site() from public, anon;
grant execute on function public.statistiques_site() to authenticated;
