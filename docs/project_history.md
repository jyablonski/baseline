# Project history

How the project got from a school Tableau dashboard to Baseline. The current shape is in [architecture.md](architecture.md).

## Timeline

| When             | Change                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Fall 2019        | Tableau dashboard, with data fetched in R.                                                                      |
| Summer 2020      | Rebuilt in R Shiny after the school Tableau license ran out. Google Sheets as the data store.                   |
| Spring 2021      | Data moved to AWS RDS on the free tier.                                                                         |
| Summer 2021      | Most of the project rewritten: Python ingestion and dbt modeling under the R Shiny dashboard.                   |
| 2021-2023        | Features added over time: Reddit and Twitter comments, sentiment analysis, play-by-play charts, ML predictions. |
| Fall 2023        | Frontend moved to a Python dashboard. R dropped entirely.                                                       |
| 2025             | AWS changed its free tier. Database and server moved to alternatives like Aiven to stay free.                   |
| Late summer 2026 | Rebuilt as a monorepo, named **Baseline**, and hosted on a single free-tier Oracle VM with 12 GB of memory.     |

## Tableau and R (2019-2020)

The project started in fall 2019 as a Tableau dashboard fed by data fetched with R. That worked well enough to put a real [dashboard](https://public.tableau.com/app/profile/jyablonski/viz/NBA2019-2020SeasonMySQL/NBADashboard) together, but the Tableau license came from school and eventually ran out.

In summer 2020 the dashboard was rebuilt in R Shiny, hosted on https://shinyapps.io, with Google Sheets as the data store.

## AWS, Python, and dbt (2021-2023)

In spring 2021 the data moved off Sheets to AWS RDS on the free tier. That summer most of the project was rewritten: ingestion moved to Python and modeling moved to dbt, with the [R Shiny dashboard](https://github.com/jyablonski/nba-dashboard) still on top.

Features accumulated from there: Reddit and Twitter comments, sentiment analysis, play-by-play charts, and ML predictions.

In fall 2023 the frontend moved to a [Python Dash dashboard](https://github.com/jyablonski/nba_elt_dashboard/) and R was dropped altogether.

## Free-tier churn (2025)

AWS changed its free tier in 2025, which forced the database and server onto other free options such as Aiven.

## What needed fixing

A few weaknesses had been building the whole time:

- **Every service lived in its own repo.** This became the biggest problem, since changes that crossed services meant coordinating across repos.
- **Components were spread across cloud providers** to keep costs at zero, stitched together with separate tooling.
- **AI-assisted development was cumbersome** because of both of the above: no single place held the whole system.

## Baseline (2026-present)

In late summer 2026 the project was completely rebuilt as a monorepo and given an actual name: Baseline. Everything now runs on one free-tier Oracle VM with 12 GB of memory (see [operations.md](operations.md)). New services like an MCP server and a semantic layer w/ Cube were added to support AI-assisted development and unified querying.

The monorepo consolidation simplified things dramatically: one repo, one host, no juggling components across providers. This is the home for the foreseeable future.
