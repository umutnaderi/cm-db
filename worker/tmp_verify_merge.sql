SELECT canonical_club_public_id, COUNT(DISTINCT database_slug) AS seasons, COUNT(*) AS name_variants
FROM canonical_club_names
WHERE canonical_club_public_id IN (
  'club_f_c_barcelona_spain','club_internazionale_italy','club_ac_milan_italy',
  'club_real_madrid_c_f_spain','club_fenerbahce_sk_turkey','club_galatasaray_sk_turkey',
  'club_parma_italy','club_arsenal_england','club_as_roma_italy',
  'club_deportivo_de_la_coruna','club_real_betis_balompie','club_fc_bayern_munchen_germany',
  'club_liverpool_england','club_atletico_de_madrid','club_manchester_united_england'
)
GROUP BY canonical_club_public_id
ORDER BY canonical_club_public_id;
