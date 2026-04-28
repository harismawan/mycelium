# Requirements Document

## Introduction

Semantic Search with Embeddings adds meaning-based search to Mycelium. Today, Mycelium's SearchService uses PostgreSQL full-text search (tsvector/tsquery) which matches on exact keywords. Semantic search uses vector embeddings to find notes by conceptual similarity — a query like "distributed systems" matches notes about microservices, event sourcing, and message queues even when those exact words are absent. Embeddings are generated via a configurable provider (OpenAI, local models), stored in PostgreSQL using the pgvector extension, and exposed through a new semantic search endpoint alongside a hybrid mode that combines FTS ranking with vector similarity. Both the existing REST API and the future MCP Server can consume the semantic search capability.

## Glossary

- **Embedding_Service**: The service responsible for generating, storing, and querying vector embeddings for notes.
- **Embedding_Provider**: An external or local model that converts text into a fixed-dimensional vector representation (e.g., OpenAI `text-embedding-3-small`, a local Ollama model).
- **Embedding**: A fixed-length floating-point vector representing the semantic meaning of a note's text content.
- **Embedding_Vector**: The PostgreSQL `vector` column storing a note's embedding, indexed for approximate nearest-neighbor search via pgvector.
- **Cosine_Similarity**: A distance metric measuring the angle between two vectors; values closer to 1.0 indicate higher semantic similarity.
- **Hybrid_Search**: A search mode that combines PostgreSQL full-text search ranking (ts_rank) with vector cosine similarity into a single relevance score.
- **Similarity_Threshold**: A configurable minimum cosine similarity score below which results are excluded from semantic search results.
- **Note**: A Markdown document in the Mycelium knowledge base with title, content, tags, status, and a searchVector column for FTS.
- **SearchService**: The existing service providing full-text search over notes using PostgreSQL tsvector indexes.
- **pgvector**: A PostgreSQL extension that adds vector data types, indexing (IVFFlat, HNSW), and distance operators for similarity search.

## Requirements

### Requirement 1: Embedding Provider Abstraction

**User Story:** As a self-hosting operator, I want to configure which embedding provider Mycelium uses, so that I can choose between cloud APIs (OpenAI) and local models based on my privacy and cost requirements.

#### Acceptance Criteria

1. THE Embedding_Service SHALL define a provider interface that accepts text input and returns a fixed-dimensional Embedding vector.
2. THE Embedding_Service SHALL support at least two provider implementations: an OpenAI provider and a configurable HTTP-based provider for local models.
3. WHEN the `EMBEDDING_PROVIDER` environment variable is set to `openai`, THE Embedding_Service SHALL use the OpenAI API with the model specified in `EMBEDDING_MODEL` (defaulting to `text-embedding-3-small`).
4. WHEN the `EMBEDDING_PROVIDER` environment variable is set to `http`, THE Embedding_Service SHALL send requests to the URL specified in `EMBEDDING_URL` and parse the response for the embedding vector.
5. IF the `EMBEDDING_PROVIDER` environment variable is not set, THEN THE Embedding_Service SHALL default to `openai`.
6. THE Embedding_Service SHALL read the `EMBEDDING_DIMENSIONS` environment variable to determine the vector size (defaulting to 1536).
7. IF the configured Embedding_Provider is unreachable at startup, THEN THE Embedding_Service SHALL log a warning and allow the API to start with semantic search disabled.

### Requirement 2: pgvector Schema and Storage

**User Story:** As a developer, I want embeddings stored in PostgreSQL using pgvector, so that I can query them with efficient approximate nearest-neighbor indexes without adding a separate vector database.

#### Acceptance Criteria

1. THE database migration SHALL enable the `vector` extension in PostgreSQL using `CREATE EXTENSION IF NOT EXISTS vector`.
2. THE database migration SHALL add an `embedding` column of type `vector(1536)` to the Note table, allowing NULL values for notes that have not yet been embedded.
3. THE database migration SHALL add an `embeddedAt` timestamp column to the Note table to track when the embedding was last generated.
4. THE database migration SHALL create an HNSW index on the `embedding` column using cosine distance for approximate nearest-neighbor search.
5. THE Embedding_Service SHALL store the generated Embedding_Vector in the note's `embedding` column and set `embeddedAt` to the current timestamp.

### Requirement 3: Embedding Generation on Note Save

**User Story:** As a note author, I want embeddings generated automatically when I save a note, so that my notes are immediately searchable by meaning without manual intervention.

#### Acceptance Criteria

1. WHEN a note is created, THE Embedding_Service SHALL generate an Embedding from the note's title and content and store the Embedding_Vector on the note.
2. WHEN a note's title or content is updated, THE Embedding_Service SHALL regenerate the Embedding and update the Embedding_Vector and `embeddedAt` timestamp.
3. WHEN a note is updated without changes to title or content, THE Embedding_Service SHALL skip embedding regeneration.
4. THE Embedding_Service SHALL generate embeddings asynchronously after the note save transaction completes, so that note creation and update latency is not blocked by the Embedding_Provider call.
5. IF the Embedding_Provider returns an error during embedding generation, THEN THE Embedding_Service SHALL log the error and leave the note's `embedding` column unchanged, allowing the note save to succeed.
6. THE Embedding_Service SHALL concatenate the note title and content with a separator (e.g., `"title \n\n content"`) as input to the Embedding_Provider.

### Requirement 4: Semantic Search Endpoint

**User Story:** As a user or AI agent, I want to search notes by meaning, so that a query like "distributed systems" finds notes about microservices, event sourcing, and message queues even when those exact terms are absent.

#### Acceptance Criteria

1. THE SearchService SHALL expose a `semanticSearch` method that accepts a query string, userId, and optional filters (status, tag, limit, cursor, threshold).
2. WHEN invoked, THE SearchService SHALL generate an Embedding for the query text using the configured Embedding_Provider.
3. THE SearchService SHALL query the Note table using pgvector's cosine distance operator (`<=>`) to find the nearest neighbors to the query Embedding, scoped to the authenticated user's notes.
4. THE SearchService SHALL exclude notes whose Cosine_Similarity falls below the Similarity_Threshold (defaulting to 0.7).
5. THE SearchService SHALL return results ordered by Cosine_Similarity descending, each containing id, slug, title, excerpt, status, and a similarity score.
6. THE SearchService SHALL support cursor-based pagination consistent with the existing search endpoint.
7. IF the Embedding_Provider is unavailable, THEN THE SearchService SHALL return an error indicating that semantic search is temporarily unavailable.
8. THE API SHALL expose the semantic search method at `GET /api/v1/notes/search/semantic` with query parameters `q`, `status`, `tag`, `limit`, `cursor`, and `threshold`.

### Requirement 5: Hybrid Search Endpoint

**User Story:** As a user, I want to combine keyword matching with semantic similarity, so that I get the best of both approaches — exact keyword hits ranked alongside conceptually related notes.

#### Acceptance Criteria

1. THE SearchService SHALL expose a `hybridSearch` method that accepts a query string, userId, and optional filters (status, tag, limit, cursor, ftsWeight, vectorWeight).
2. WHEN invoked, THE SearchService SHALL execute both a full-text search (using the existing tsvector infrastructure) and a semantic vector search in parallel.
3. THE SearchService SHALL compute a combined score using the formula: `score = (ftsWeight * normalized_fts_rank) + (vectorWeight * cosine_similarity)`, where ftsWeight defaults to 0.4 and vectorWeight defaults to 0.6.
4. THE SearchService SHALL merge and deduplicate results from both searches, using the combined score for final ordering.
5. THE SearchService SHALL return results ordered by combined score descending, each containing id, slug, title, excerpt, status, ftsRank, similarity, and combinedScore.
6. THE API SHALL expose the hybrid search method at `GET /api/v1/notes/search/hybrid` with query parameters `q`, `status`, `tag`, `limit`, `cursor`, `ftsWeight`, and `vectorWeight`.
7. IF a note has no Embedding_Vector (embedding column is NULL), THEN THE SearchService SHALL include the note in hybrid results using only its FTS rank with a similarity score of 0.

### Requirement 6: Bulk Embedding Backfill

**User Story:** As an operator deploying semantic search to an existing Mycelium instance, I want to generate embeddings for all existing notes, so that the full knowledge base is searchable by meaning from day one.

#### Acceptance Criteria

1. THE Embedding_Service SHALL provide a `backfillEmbeddings` method that generates embeddings for all notes where the `embedding` column is NULL.
2. THE `backfillEmbeddings` method SHALL process notes in batches of a configurable size (defaulting to 50) to avoid overwhelming the Embedding_Provider.
3. THE `backfillEmbeddings` method SHALL respect Embedding_Provider rate limits by inserting a configurable delay between batches (defaulting to 200ms).
4. IF the Embedding_Provider returns an error for a specific note during backfill, THEN THE Embedding_Service SHALL log the error, skip the note, and continue processing the remaining notes.
5. THE API SHALL expose a backfill trigger at `POST /api/v1/admin/embeddings/backfill` requiring an API key with `admin` scope.
6. THE `backfillEmbeddings` method SHALL return a summary containing the total notes processed, the count of successful embeddings, and the count of failures.

### Requirement 7: Embedding Status and Observability

**User Story:** As an operator, I want to see which notes have embeddings and the overall embedding coverage, so that I can monitor the health of the semantic search system.

#### Acceptance Criteria

1. THE API SHALL expose an embedding status endpoint at `GET /api/v1/admin/embeddings/status` requiring an API key with `admin` scope.
2. WHEN invoked, THE status endpoint SHALL return the total note count, the count of notes with embeddings, the count of notes without embeddings, the configured Embedding_Provider name, and the configured vector dimensions.
3. WHEN a note is returned from any note endpoint (GET, list, search), THE response SHALL include an `embedded` boolean field indicating whether the note has an Embedding_Vector.

### Requirement 8: Semantic Search via MCP Server

**User Story:** As an AI agent connecting through the MCP Server, I want to use semantic search tools, so that I can find conceptually related notes through the same tool interface used for keyword search.

#### Acceptance Criteria

1. WHEN the MCP Server is implemented, THE MCP_Server SHALL register a tool named `semantic_search` that accepts a required `query` string parameter and optional `threshold`, `tag`, `status`, and `limit` parameters.
2. WHEN invoked, THE `semantic_search` tool SHALL call the SearchService `semanticSearch` method and return results in the same format as the `search_notes` tool with an additional similarity score field.
3. WHEN the MCP Server is implemented, THE MCP_Server SHALL register a tool named `hybrid_search` that accepts a required `query` string parameter and optional `tag`, `status`, `limit`, `ftsWeight`, and `vectorWeight` parameters.
4. WHEN invoked, THE `hybrid_search` tool SHALL call the SearchService `hybridSearch` method and return results with ftsRank, similarity, and combinedScore fields.
