# Scoring and adaptation

This platform does not reproduce College Board's confidential IRT parameters, official routing thresholds, equating or percentiles. Official SAT structure is used; scores are labeled **Estimated SAT Score**. Original sample questions are demonstration content, not calibrated assessment forms.

The default `estimated-linear-v1` strategy estimates each completed full-test section as `roundTo10(200 + 600 × correct / total)`, constrained to 200–800. The two section estimates sum to 400–1600. Unanswered questions count as incorrect. Practice sessions show accuracy instead of an SAT score. No arbitrary lower-route score ceiling is imposed. The displayed ±60 total-score interval is an illustrative internal range, not a statistically validated confidence interval or official prediction.

The route model is independent of scoring. `accuracy-threshold-v1` selects a higher second module when module-1 accuracy meets the blueprint threshold (default 0.65); otherwise it selects the lower module. Question versions and both route pools are captured before testing. Every selected pool is disjoint, deterministic for a given bank snapshot/seed, and domain-balanced under the standard blueprint. The threshold is an editable internal practice assumption.

Seven domain segments approximate performance as `max(1, min(7, round(6 × accuracy) + 1))` when at least one question was assessed. No assessed questions displays zero filled segments and “No questions assessed.” These are not College Board Knowledge and Skills proficiency estimates. Official proficiency reporting also reflects question difficulty; this internal accuracy proxy is explicitly disclosed in the report.

Reports persist `scoreModelVersion`, original section/total scores, route decisions, domain/skill/difficulty counts and exact question versions. A later scoring upgrade must create a new version; saved results are not silently recomputed. Authorized official mappings or empirical calibration must be supplied before those modes can produce scores. No such dataset is bundled.

Time-on-question captures active visible time and persists accumulated milliseconds; it excludes a paused practice session. The server caps received time to available module time. It is study telemetry, not tamper-proof proctoring. Very short/long times can inform review but do not establish that a student guessed.

## Supplied scoring configuration

`server/scoring.ts` implements a ScoringEngine boundary with estimated, supplied form-mapping, and calibrated-internal conversion strategies. Set `SCORING_MODEL_FILE` to trusted JSON with `version`, `kind`, `label`, and `forms`. Each form contains `section`, exact `questionIds`, `questionVersions` mapping each id to its immutable version, and `scores` indexed by correct count from 0 through N (N+1 entries, each 200–800). Every possible selected adaptive route needs a matching conversion before the server permits a full test to start. Wrong forms or versions fail closed. A supplied conversion does not establish official authorization or validated IRT calibration. The configured model is snapshotted in the attempt.

Standard full-test pools use complementary module quotas: Reading/Writing Information and Ideas 14, Craft and Structure 15, Expression of Ideas 11, Standard English Conventions 14; Math Algebra 15, Advanced Math 15, Problem-Solving and Data Analysis 7, Geometry and Trigonometry 7. Custom practice supports positive relative domain weights for a selected section, normalized using largest remainders. Custom weights cannot alter strict SAT mode.
