{#
    Basketball-Reference injury notes lead with a status and the body part:
    "Out (Ankle) - Left ankle sprain", "Day To Day (Foot) - Soreness",
    "Out For Season (Knee) - ...". Anything that does not lead that way is
    "Listed" rather than a guess.
#}
{% macro injury_status(description) -%}
case lower(btrim(substring({{ description }} from '^([^()]+?)\s*\(')))
    when 'out' then 'Out'
    when 'day to day' then 'Day To Day'
    when 'out for season' then 'Out For Season'
    else 'Listed'
end
{%- endmacro %}

{% macro injury_detail(description) -%}
nullif(btrim(substring({{ description }} from '^[^()]+\(([^)]*)\)')), '')
{%- endmacro %}

{# "2026-27" -> "2025-26". #}
{% macro previous_season(season) -%}
(left({{ season }}, 4)::int - 1)::text || '-' || right(left({{ season }}, 4), 2)
{%- endmacro %}
