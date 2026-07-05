---
description: "Use when planning, creating, moving, updating, or reviewing Azure DevOps Boards work items for the yuvi-720 project, especially 720 deadline tasks and requirement coverage."
---
# Azure DevOps Boards Guidelines

- Azure DevOps organization: `https://dev.azure.com/yuvilab`.
- Azure DevOps project: `Yuvi`.
- Use Azure DevOps MCP tools when available for reading, creating, moving, or updating work items.
- Do not place personal access tokens or secrets in repo files. Prefer `az login` / Entra authentication.
- Tag work items with the relevant 720 feature number, for example `720-feature-3-agent`, `720-feature-6-teacher-view`, or `720-localization`.
- For minimum-requirement work, include the exact requirement clause in the work item description.
- Link implementation tasks to proof artifacts needed for submission: demo video, mockup, evidence, or target date.
- Keep acceptance criteria concrete and demoable.
- When updating status, include the reason and any blocker, especially if a capability is planned but not yet implemented.
- For AI-generated insights or agent features, include privacy and explainability acceptance criteria.