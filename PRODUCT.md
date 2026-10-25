# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

EV drivers looking for a compatible, available charging station; charging-network operators and service teams monitoring connector health and deciding what to inspect or repair.

## Product Purpose

EVOLT turns charger availability and connector-health evidence into two focused experiences: a simple public way to find a better charging option, and an operator workspace for understanding fleet condition and acting on issues.

## Positioning

EVOLT connects explainable connector-health evidence with practical charging decisions. It ranks alternatives by health evidence before distance, while giving operators the underlying measurements, alerts, and quality limits.

## Operating Context

Drivers use the public experience while choosing or replacing a charging stop. Operators use the private-style console to review stations, chargers, observations, alerts, analytical assessments, and imported datasets.

## Capabilities and Constraints

- Public station and recommendation views must show imported, non-synthetic records only.
- Operator views may expose operational diagnostics and data provenance.
- Health categories describe evidence in recorded data and are not safety certifications.
- Distances are straight-line unless a future routing service is added.
- The current local seed is synthetic demonstration data and must never be presented as real telemetry.
- Authentication and authorization for a production operator workspace remain an open deployment decision.

## Brand Commitments

Keep the EVOLT name, IBM Plex typography, dark technical workspace palette, and direct evidence-first voice.

## Evidence on Hand

The repository contains a PostgreSQL schema, import pipeline, connector-health analysis, station discovery, recommendations, alert workflows, and a clearly labelled synthetic seed for local development. No verified production station feed is included.

## Product Principles

- Make the next action obvious.
- Explain evidence in language a non-specialist can use.
- Never turn missing or synthetic data into false confidence.
- Keep driver choices simple and operator diagnostics deep.

## Accessibility & Inclusion

Preserve keyboard access, visible focus, readable contrast, non-colour status shapes, and responsive layouts for mobile drivers and desktop operators.
