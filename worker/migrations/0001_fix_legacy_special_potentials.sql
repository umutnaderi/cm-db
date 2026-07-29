UPDATE player_search
SET potential_ability = CASE potential_ability
  WHEN 126 THEN -2
  WHEN 127 THEN -1
END
WHERE database_slug IN ('cm9697_vanilla_original', 'cm9798_vanilla_original')
  AND potential_ability IN (126, 127);

UPDATE player_profile
SET potential_ability = CASE potential_ability
  WHEN 126 THEN -2
  WHEN 127 THEN -1
END
WHERE database_slug IN ('cm9697_vanilla_original', 'cm9798_vanilla_original')
  AND potential_ability IN (126, 127);
