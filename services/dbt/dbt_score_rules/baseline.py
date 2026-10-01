"""Repo-specific dbt-score rules, discovered via the default dbt_score_rules namespace."""

from dbt_score import Model, RuleViolation, Severity, rule

# Test names as they appear in the manifest's test_metadata.name (no package prefix).
NOT_NULL_TESTS = {"not_null", "expect_column_values_to_not_be_null"}
COLUMN_GRAIN_TESTS = {"unique", "expect_column_values_to_be_unique"}
MODEL_GRAIN_TESTS = {"expect_compound_columns_to_be_unique", "unique_combination_of_columns"}


@rule(severity=Severity.HIGH)
def has_grain_test(model: Model) -> RuleViolation | None:
    """A model should declare its grain with a uniqueness test."""
    if any(test.type in MODEL_GRAIN_TESTS for test in model.tests):
        return None
    if any(test.type in COLUMN_GRAIN_TESTS for column in model.columns for test in column.tests):
        return None
    return RuleViolation(
        message="No uniqueness test: add unique on the key column or expect_compound_columns_to_be_unique."
    )


@rule
def id_columns_have_not_null(model: Model) -> RuleViolation | None:
    """Every declared *_id column should have a not_null test, unless meta nullable: true says why not."""
    missing = [
        column.name
        for column in model.columns
        if column.name.endswith("_id")
        # dbt 1.10+ moves meta under config; accept either spelling.
        and not (column.meta.get("nullable") or column.config.get("meta", {}).get("nullable"))
        and not any(test.type in NOT_NULL_TESTS for test in column.tests)
    ]
    if missing:
        return RuleViolation(message=f"*_id columns without not_null: {', '.join(missing)}.")
    return None
