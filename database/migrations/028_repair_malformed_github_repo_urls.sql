-- Repair persisted github_repo values matching https://github.com/{owner}/{owner}/{repository}
begin;

update public.projects
set
  github_repo = regexp_replace(
    github_repo,
    '^https://github\.com/([^/]+)/\1/([^/]+)/?$',
    'https://github.com/\1/\2',
    'i'
  ),
  updated_at = now()
where github_repo ~* '^https://github\.com/([^/]+)/\1/([^/]+)/?$';

commit;
