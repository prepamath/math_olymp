-- Plusieurs comptes peuvent avoir le mode prof : la liste est dans private.profs
-- au lieu de l'adresse 'prof@maths.local' écrite en dur partout.
create table if not exists private.profs (email text primary key);
insert into private.profs (email) values ('prof@maths.local'), ('martin@maths.local')
on conflict do nothing;

create or replace function public.est_prof()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.profs where email = auth.jwt() ->> 'email');
$$;
revoke all on function public.est_prof() from public, anon;
grant execute on function public.est_prof() to authenticated;

drop policy "Seul le prof a accès direct à la configuration brute" on public.configuration_site;
create policy "Seul le prof a accès direct à la configuration brute" on public.configuration_site
  for all to authenticated using (public.est_prof()) with check (public.est_prof());

drop policy "Le prof peut voir toutes les réponses des élèves" on public.reponses_eleves;
create policy "Le prof peut voir toutes les réponses des élèves" on public.reponses_eleves
  for select to authenticated using (public.est_prof());

-- Remplace le test d'adresse dans les fonctions existantes.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.verifier_reponse_serveur(text,text,text)'::regprocedure);
  execute replace(v_def, $r$v_email = 'prof@maths.local'$r$, 'public.est_prof()');

  v_def := pg_get_functiondef('public.etat_exercice(text)'::regprocedure);
  execute replace(v_def, $r$auth.jwt() ->> 'email' = 'prof@maths.local'$r$, 'public.est_prof()');

  -- Les réponses des profs ne comptent pas dans les statistiques.
  v_def := pg_get_functiondef('public.statistiques_site()'::regprocedure);
  execute replace(v_def, $r$r.identifiant_eleve <> 'prof'$r$,
    $r$r.identifiant_eleve not in (select split_part(email, '@', 1) from private.profs)$r$);
end;
$$;
