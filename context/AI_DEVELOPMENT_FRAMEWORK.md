# AI-Augmented Development Framework

This boilerplate provides a standardized persistent memory system for AI-assisted software development. Copy this folder structure to any new project to maintain architectural continuity across AI coding sessions.

## Core Principles

1. **Single Source of Truth**: All critical project knowledge lives in `/context/` markdown files
2. **AI Context Preservation**: Files are updated after every meaningful change to maintain state
3. **Structured Evolution**: Changes follow phased implementation with explicit validation

## Context Structure

```
context/
├── project-overview.md     # Executive summary, vision, scope
├── architecture-context.md # System boundaries, tech stack, data flows
├── AGENTS.md               # AI roles, permissions, communication protocols
├── ai-workflow-rules.md    # Coding standards, security rules, phased plan
├── code-standards.md       # Language-specific conventions, linting rules
├── progress-tracker.md     # Sprint backlog, completed tasks, next steps
├── domain-spec.md          # Project-specific requirements and tool schemas
└── ui-context.md           # Component hierarchy, design tokens, shortcuts
```

## File Templates

### project-overview.md
```
# [Project Name]

## Overview
[Concise description of project purpose and key features]

## Goals
1. [Primary goal]
2. [Secondary goal]

## Scope
### In Scope
- [Feature 1]
- [Feature 2]

### Out of Scope
- [Excluded items]

## Success Criteria
1. [Measurable outcome 1]
2. [Measurable outcome 2]
```

### architecture-context.md
```
# Architecture Context

## Tech Stack
| Layer       | Technology | Role |
|-------------|------------|------|
| [Layer]     | [Tech]     | [Description] |

## System Boundaries
- `[path]` — [Component purpose]

## Data Flow
[Diagram or description of key data pathways]

## Critical Invariants
1. [Invariant 1 - must always be true]
```

### ai-workflow-rules.md
```
# AI Workflow Rules

## Implementation Phases
- **Phase 1**: [Discovery & Setup]
- **Phase 2**: [Core Implementation]
- **Phase 3**: [Integration & Testing]

## Mandatory Practices
- Read ALL `.md` files before starting work
- Update context files within 1 hour of implementation changes
- Never guess architecture - ask for clarification when uncertain

## Security Requirements
- [Project-specific security constraints]
```

### progress-tracker.md
```
# Progress Tracker

## Current Phase
- [Active phase name]

## Completed
- [x] [Task 1]
- [x] [Task 2]

## In Progress
- [ ] [Current task]

## Next Up
- [ ] [Next task]

## Blocked Items
- [ ] [Blockers with resolution path]
```

## Implementation Guide

1. **Before Starting**:
   - Read all context files
   - Verify no outstanding blockers

2. **During Development**:
   - Update `progress-tracker.md` in real-time
   - Document architectural decisions in relevant context files

3. **After Completion**:
   - Validate all context files reflect current state
   - Commit with message: `[Context] Update persistent memory for [feature]`

## Customization Tips

- For ML projects: Duplicate `domain-spec.md` as `ML_LABELING_PIPELINE_SPEC.md`
- For UI-heavy projects: Expand `ui-context.md` with design tokens
- Add project-specific context files as needed (e.g., `compliance-requirements.md`)
