{% macro ordinal(expression) -%}
({{ expression }})::text || case
    when ({{ expression }}) % 100 between 11 and 13 then 'th'
    when ({{ expression }}) % 10 = 1 then 'st'
    when ({{ expression }}) % 10 = 2 then 'nd'
    when ({{ expression }}) % 10 = 3 then 'rd'
    else 'th'
end
{%- endmacro %}
