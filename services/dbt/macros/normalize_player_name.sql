{% macro normalize_player_name(column) -%}
trim(
    regexp_replace(
        regexp_replace(
            regexp_replace(
                lower(unaccent({{ column }})),
                '\y(jr\.?|sr\.?|iii|ii|iv)\y',
                ' ',
                'g'
            ),
            '[^a-z0-9]+',
            ' ',
            'g'
        ),
        '\s+',
        ' ',
        'g'
    )
)
{%- endmacro %}
