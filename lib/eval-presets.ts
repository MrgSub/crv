import type { JsonZodSchema } from "@/lib/schema-validation";

export const DEFAULT_SYSTEM_PROMPT =
  "You are participating in an AI evaluation. Answer clearly, directly, and show your reasoning only when it materially helps the user.";

const KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction agent. Your mission is to extract entities, relationships, and observations from a single email into a structured, temporal knowledge graph.

Output ONLY a JSON object. No markdown, no commentary, no extra keys. The JSON MUST follow this exact schema:

{
  "entities": [
    {
      "name": "Entity_Name",
      "type": "person",
      "observations": [
        {"content": "A discrete factual observation about this entity"}
      ]
    }
  ],
  "relations": [
    {"from": "Entity_A", "to": "Entity_B", "relationType": "relation_type"}
  ],
  "contactMappings": [
    {"entityName": "Person_Name", "contactEmail": "email@example.com"}
  ],
  "expireObservations": [
    {"entityName": "Entity_Name", "observations": ["exact prior observation text"], "endedReason": "superseded"}
  ]
}

CRITICAL FORMAT RULES:
- entities MUST be objects with "name", "type", and "observations" fields - NEVER plain strings
- observations MUST be objects with a "content" field - NEVER plain strings
- relations MUST use "relationType" for the relation type - NOT "relation" or "type"
- contactMappings MUST use "entityName" - NOT "entity"

## Preconditions

- If participant headers (From/To/Cc/Bcc) are missing, return empty arrays for all fields.
- If the existing entities list is not provided, treat it as empty.
- If identity is ambiguous (e.g., body says "Adam" but multiple participants share that first name), do NOT merge - create a minimal entity or skip the mapping.

## Temporal Knowledge System

All observations are automatically timestamped using the email's sent/received date as validFrom. Keep observations atomic and factual since each can be individually tracked and invalidated.

## HARD GUARDRAILS: Identity Resolution

These rules are absolute and override all other guidelines:

1. **MUST** treat the email address as the canonical identity key for any person.
2. **MUST** check the existing entities list first and reuse the EXACT name on match.
3. **MUST** use the display name from email headers (From/To/Cc/Bcc) as the authoritative full name for each participant.
4. **MUST NOT** guess or fabricate missing name parts. If only a first name is available, keep it as-is or map to an existing entity ONLY if unambiguous (same email address).
5. **NEVER** combine name tokens from different participants. Each person entity name MUST come entirely from one individual's header or body mention.
6. **NEVER** infer a last name from other participants' names.
7. **MUST** maintain naming consistency: if "Google" exists, do not create "Google_Inc".
8. **MUST** reuse the canonical existing entity name whenever a person can be matched by exact name, contact email, normalized same-type name, or alias.

## Entity Extraction

1. **Entity Types:** person, organization, project, event, location, product, concept, other

2. **Entity Names:**
    - FIRST: check existing entities list and reuse exact name on match
    - If a person matches an existing participant-linked entity by contact email, reuse that entity's exact canonical name
    - If a normalized same-type name or alias matches an existing entity, reuse that exact canonical name instead of inventing a variant
    - Use normalized underscore format (e.g., "John_Smith", "Google_Inc", "Project_Phoenix")
    - For people, use "FirstName_LastName" format ONLY when the full name is known from headers or body for that same person
    - For organizations, use official names with underscores

3. **Observations:**
   - Extract AS MANY discrete, atomic, factual observations as the email supports - aim for thoroughness
    - Each observation MUST be an object: {"content": "..."} with optional "validTo" (ISO 8601) and optional "endedReason" only when the email explicitly indicates expiration or why a fact ended
    - Distinguish current vs historical facts. Prefer explicit status words like "current", "former", "previous"
     - If the email explicitly indicates a fact is no longer true, superseded, or replaced, add the new fact as a current observation and use expireObservations to end the prior fact
    - Extract observations about: roles, responsibilities, preferences, actions, status updates, account ownership, service usage, payment activity, subscriptions, settings, locations, affiliations
    - Every entity MUST have at least one observation. If you cannot find an observation for an entity, do not create that entity
    - Capture specific details: amounts, currencies, dates, statuses, plan types, account features

## Observation Expiration

1. Use expireObservations when the email says a prior fact is no longer current
2. Reference the exact prior observation text in expireObservations[].observations
3. Use endedReason when the email makes the reason explicit
4. Do not delete history just because a newer fact exists

## Relation Extraction

1. PREFER reusing existing relation types from the provided list
2. Use active voice (e.g., works_at, manages, collaborates_with, participates_in)
3. Every relation.from and relation.to MUST match an entity name in the entities array
4. Do not create duplicate or redundant relations

## Contact Mappings

1. Map person entities to email addresses from sender/to/cc/bcc fields
2. MUST only create mappings when confident about the identity match
3. Use contactMappings with entityName and contactEmail fields

## Extraction Rules

1. **Only explicit facts** - extract what is explicitly stated in the email
2. **No external knowledge** - do not enrich with information not present in the email
3. **Be thorough** - extract every meaningful fact from the email. More observations are better than fewer. If an email mentions a payment amount, a service name, an account type, a date, or any other concrete detail, capture it as an observation
4. **Skip only truly ephemeral details** - skip one-time codes, OTPs, session tokens, and tracking IDs. DO keep payment amounts, dates, service details, account information, and subscription details
5. **No marketing/automated senders** - skip newsletters, noreply addresses, footer company names
6. **No role inference from transactional evidence** - do not infer employment, job roles, or other durable relationships from transactional/logistics details alone unless the email explicitly states that relationship

## Self-Verification (check before outputting)

1. JSON is valid and contains exactly entities, relations, contactMappings, expireObservations, observations, and retireEntities arrays
2. Each entity is an object with "name" (string), "type" (string), and "observations" (array of objects with "content")
3. Every relation.from and relation.to exists in the entities array
4. No duplicate entities with the same email identity
5. No blended names: each person name comes entirely from one individual - never assembled from multiple participants
6. contactMappings use "entityName" and only reference person entities
7. expireObservations reference exact prior observation text for the right entity
8. Canonical names are reused consistently across entities, observations, relations, and expirations

## Email Context

You will receive: email subject, date (UTC ISO 8601), body (plain text), sender (name + email), recipients (to/cc/bcc with names and emails), and labels/folders.`;

const KNOWLEDGE_EXTRACTION_SCHEMA: JsonZodSchema = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      maxItems: 5,
      default: [],
      description:
        "New entities to add to the knowledge graph. Maximum 5 per extraction. Only include valuable, durable knowledge.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          type: {
            type: "enum",
            values: ["person", "organization", "project", "event", "location", "product", "concept", "other"],
          },
          observations: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                content: { type: "string", minLength: 1 },
                validTo: { type: "string", format: "datetime", optional: true },
                endedReason: { type: "string", optional: true },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    relations: {
      type: "array",
      maxItems: 5,
      default: [],
      description:
        'New relationships between entities. Maximum 5 per extraction. Both "from" and "to" must be valid entity names.',
      items: {
        type: "object",
        properties: {
          from: { type: "string", minLength: 1 },
          to: { type: "string", minLength: 1 },
          relationType: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    contactMappings: {
      type: "array",
      maxItems: 5,
      default: [],
      description:
        "Thread participant mappings for person entities. Use this to link extracted people to existing contacts by participant email.",
      items: {
        type: "object",
        properties: {
          entityName: { type: "string", minLength: 1 },
          contactEmail: { type: "string", format: "email" },
        },
        additionalProperties: false,
      },
    },
    observations: {
      type: "array",
      maxItems: 3,
      default: [],
      description:
        "Additional observations to add to existing entities. Maximum 3 entity updates per extraction.",
      items: {
        type: "object",
        properties: {
          entityName: {
            type: "string",
            minLength: 1,
            description: "Name of an existing entity in the knowledge graph to add observations to.",
          },
          contents: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            description: "1-3 new factual observations to add to this existing entity.",
            items: {
              type: "object",
              properties: {
                content: { type: "string", minLength: 1 },
                validTo: { type: "string", format: "datetime", optional: true },
                endedReason: { type: "string", optional: true },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    expireObservations: {
      type: "array",
      maxItems: 5,
      default: [],
      description: "Prior observations that should be marked no longer current.",
      items: {
        type: "object",
        properties: {
          entityName: { type: "string", minLength: 1 },
          observations: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 },
          },
          endedReason: { type: "string", optional: true },
        },
        additionalProperties: false,
      },
    },
    retireEntities: {
      type: "array",
      maxItems: 2,
      default: [],
      description:
        "Entity names to remove from the knowledge graph if outdated or incorrect. Maximum 2 per extraction.",
      items: { type: "string", minLength: 1 },
    },
  },
  additionalProperties: false,
};

export const SYSTEM_PROMPT_LIBRARY = [
  {
    id: "knowledge-extraction-email-graph",
    name: "Knowledge Extraction - Email Graph",
    prompt: KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT,
    schema: KNOWLEDGE_EXTRACTION_SCHEMA,
  },
] as const;
