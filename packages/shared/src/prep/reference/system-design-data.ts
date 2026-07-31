// AUTO-GENERATED from the agent prep artifacts (colors stripped). Display-only reference data.
export const TECH_COMPARISONS = [
  {
    "category": "Message Queue",
    "options": [
      {
        "name": "Kafka",
        "what": "Distributed event streaming platform. Runs as a cluster of brokers. You publish messages to topics, consumers read from partitions.",
        "strengths": "Ordered, replay, high throughput, partitioning",
        "weaknesses": "Complex ops, overkill for simple queues",
        "when": "Event streams, CDC, audit logs"
      },
      {
        "name": "SQS",
        "what": "AWS managed message queue service. Fully serverless — no brokers to manage. Two modes: standard (best-effort order) and FIFO.",
        "strengths": "Managed, simple, scales to zero, DLQ built-in",
        "weaknesses": "No ordering guarantees (FIFO has limits), no replay",
        "when": "Simple async work queues"
      },
      {
        "name": "RabbitMQ",
        "what": "Open-source message broker in Erlang. Runs as a server process. Supports AMQP protocol with exchanges and bindings for flexible routing.",
        "strengths": "Complex routing, priority queues, lightweight",
        "weaknesses": "Harder to scale horizontally, no built-in replay",
        "when": "Task routing with complex rules"
      }
    ]
  },
  {
    "category": "Database",
    "options": [
      {
        "name": "PostgreSQL",
        "what": "Open-source relational database server. SQL-based, strong ACID guarantees. Extensible via plugins (PostGIS, TimescaleDB).",
        "strengths": "ACID, JSONB, rich queries, extensions (PostGIS, timescale)",
        "weaknesses": "Vertical scaling limits, replication lag",
        "when": "Source of truth, relational data, complex queries"
      },
      {
        "name": "MongoDB",
        "what": "Open-source document database. Stores JSON-like BSON documents. Runs as a replica set or sharded cluster.",
        "strengths": "Flexible schema, horizontal scaling, document model",
        "weaknesses": "Weaker transactions (pre-4.0 mindset), query planner surprises",
        "when": "Evolving schemas, document-heavy, prototyping"
      },
      {
        "name": "Cassandra",
        "what": "Open-source wide-column store. Peer-to-peer distributed — no single leader. Designed for write-heavy workloads across data centers.",
        "strengths": "Write-heavy, linear scaling, multi-DC replication",
        "weaknesses": "Limited queries (no joins), eventual consistency",
        "when": "Time-series, high write throughput, geo-distributed"
      },
      {
        "name": "CockroachDB",
        "what": "Distributed SQL database inspired by Google Spanner. Cluster of nodes providing serializable transactions across regions. Wire-compatible with PostgreSQL.",
        "strengths": "Distributed SQL, strong consistency, PostgreSQL-compatible",
        "weaknesses": "Write latency (consensus), operational complexity",
        "when": "Global strong consistency needs"
      }
    ]
  },
  {
    "category": "Cache",
    "options": [
      {
        "name": "Redis",
        "what": "In-memory data structure store. Runs as a server. Supports strings, hashes, lists, sets, sorted sets, streams. Can be clustered for sharding.",
        "strengths": "Data structures, Lua scripting, pub/sub, TTL",
        "weaknesses": "Memory-bound, single-threaded (per shard)",
        "when": "Session store, rate limiting, leaderboards, caching"
      },
      {
        "name": "Memcached",
        "what": "In-memory key-value cache server. Simpler than Redis — just key/value with TTL. Multi-threaded by default.",
        "strengths": "Simple, multi-threaded, mature",
        "weaknesses": "No data structures, no persistence, no pub/sub",
        "when": "Pure key-value caching, nothing else"
      }
    ]
  },
  {
    "category": "Search",
    "options": [
      {
        "name": "Elasticsearch",
        "what": "Distributed search engine built on Apache Lucene. Runs as a cluster of nodes. Stores data in inverted indices. REST API for queries.",
        "strengths": "Full-text, aggregations, distributed, mature ecosystem",
        "weaknesses": "Resource-hungry, complex cluster management",
        "when": "Full-text search, log analytics, faceted search"
      },
      {
        "name": "Typesense",
        "what": "Open-source search engine in C++. Runs as a single binary. Optimized for typo-tolerance and instant search. Simpler alternative to ES.",
        "strengths": "Simple, fast, typo-tolerant, easy to operate",
        "weaknesses": "Less powerful aggregations, smaller ecosystem",
        "when": "Simple search with great DX"
      }
    ]
  },
  {
    "category": "Time-Series DB",
    "options": [
      {
        "name": "ClickHouse",
        "what": "Open-source columnar OLAP database from Yandex. Runs as a server. Designed for fast analytical queries over huge datasets. SQL interface.",
        "strengths": "Blazing fast OLAP, columnar, compression",
        "weaknesses": "Not great for point lookups, harder ops",
        "when": "Analytics dashboards, metrics at scale"
      },
      {
        "name": "TimescaleDB",
        "what": "PostgreSQL extension (not a separate DB). Adds hypertables and time-based partitioning to Postgres. Install as a plugin.",
        "strengths": "PostgreSQL extension, familiar SQL, hypertables",
        "weaknesses": "Scaling ceiling vs native TSDB",
        "when": "When you already have Postgres and need time-series"
      },
      {
        "name": "Prometheus",
        "what": "Open-source monitoring server. Pulls metrics from targets via HTTP on a schedule. Has its own TSDB. Paired with Grafana for dashboards.",
        "strengths": "Pull-based, great with K8s, PromQL, Grafana integration",
        "weaknesses": "Not for long-term storage, single-node by default",
        "when": "Infrastructure metrics + alerting"
      }
    ]
  },
  {
    "category": "Workflow Engine",
    "options": [
      {
        "name": "Temporal",
        "what": "Open-source durable execution platform (server cluster). You write workflows as code (Go/Java/Python/TS) — Temporal handles retries, state, and recovery.",
        "strengths": "Durable execution, retries, saga pattern, versioning",
        "weaknesses": "Learning curve, operational overhead",
        "when": "Complex multi-step workflows (onboarding, payroll runs)"
      },
      {
        "name": "Celery",
        "what": "Python library (not a server). Distributed task queue using a broker (Redis/RabbitMQ) to dispatch tasks to worker processes you run.",
        "strengths": "Simple, Python-native, mature, widely known",
        "weaknesses": "No durable state, limited retry sophistication",
        "when": "Simple async task execution"
      },
      {
        "name": "Step Functions",
        "what": "AWS managed serverless workflow service. You define state machines in JSON. AWS executes and manages the flow. No servers.",
        "strengths": "Managed, visual editor, integrates with AWS",
        "weaknesses": "AWS lock-in, state machine limits, cost at scale",
        "when": "AWS-native, simple orchestration"
      }
    ]
  },
  {
    "category": "Load Balancer / Proxy",
    "options": [
      {
        "name": "NGINX",
        "what": "Open-source web server and reverse proxy (server process). Handles HTTP routing, TLS termination, static files, and upstream load balancing.",
        "strengths": "Battle-tested, fast, reverse proxy + LB + TLS termination",
        "weaknesses": "Config complexity, limited dynamic service discovery",
        "when": "Simple reverse proxy, static routing, TLS termination"
      },
      {
        "name": "Envoy",
        "what": "Open-source L7 proxy (server process, built by Lyft, now CNCF). gRPC-native with built-in observability, circuit breaking, retries. Used as sidecar in service meshes.",
        "strengths": "L7 proxy, gRPC-native, observability built-in, service mesh ready",
        "weaknesses": "Heavier, overkill for simple setups",
        "when": "Service mesh (Istio), gRPC, advanced traffic shaping"
      },
      {
        "name": "ALB / NLB",
        "what": "AWS managed load balancers. ALB = Layer 7 (HTTP path routing). NLB = Layer 4 (TCP/UDP, ultra-low latency). Both auto-scale. No servers to manage.",
        "strengths": "Managed, auto-scaling, native AWS integration",
        "weaknesses": "AWS lock-in, limited customization",
        "when": "AWS-native, don't want to operate your own LB"
      },
      {
        "name": "HAProxy",
        "what": "Open-source high-performance TCP/HTTP load balancer (server process). Fine-grained control over routing, health checks, and connection handling.",
        "strengths": "Very fast L4/L7, fine-grained control, widely used",
        "weaknesses": "Manual config, no built-in service discovery",
        "when": "High-performance TCP/HTTP load balancing"
      }
    ]
  },
  {
    "category": "CDN",
    "options": [
      {
        "name": "CloudFront",
        "what": "AWS managed CDN. Caches content at 400+ edge locations globally. Supports Lambda@Edge for running code at the edge. No servers to manage.",
        "strengths": "AWS-native, Lambda@Edge for compute at edge",
        "weaknesses": "AWS lock-in, slower cache invalidation",
        "when": "AWS-heavy stack, edge compute needed"
      },
      {
        "name": "Cloudflare",
        "what": "Global edge network (SaaS). Provides CDN, DDoS protection, DNS, and Workers (serverless edge compute). Not tied to any cloud provider.",
        "strengths": "Huge edge network, DDoS protection, Workers for edge compute, free tier",
        "weaknesses": "Less AWS integration, some vendor lock-in",
        "when": "Global CDN + security + edge compute"
      },
      {
        "name": "Fastly",
        "what": "Edge cloud platform (SaaS). Known for near-instant cache purging (<150ms). Uses VCL (Varnish Config Language) for custom edge logic.",
        "strengths": "Instant purge (<150ms), VCL for custom logic, real-time analytics",
        "weaknesses": "Pricier, smaller edge network than Cloudflare",
        "when": "When cache invalidation speed is critical (news, feeds)"
      }
    ]
  },
  {
    "category": "Object Storage",
    "options": [
      {
        "name": "S3",
        "what": "AWS managed object storage (serverless). Stores arbitrary blobs with key-based access. 11 nines durability. No servers to manage.",
        "strengths": "Durable (11 9s), lifecycle policies, event triggers, versioning",
        "weaknesses": "AWS lock-in, eventual consistency on overwrites",
        "when": "Binary files, backups, data lake, document storage"
      },
      {
        "name": "GCS",
        "what": "Google Cloud managed object storage (serverless). S3-like API. Strong read-after-write consistency. Integrates with BigQuery.",
        "strengths": "Strong consistency, BigQuery integration, similar to S3",
        "weaknesses": "GCP lock-in",
        "when": "GCP stack, or need strong consistency on reads"
      },
      {
        "name": "MinIO",
        "what": "Open-source object storage server (you run it). S3-compatible API. Written in Go. Deploy on your own hardware or VMs.",
        "strengths": "S3-compatible, self-hosted, open source",
        "weaknesses": "You operate it, smaller ecosystem",
        "when": "On-prem, hybrid cloud, data sovereignty requirements"
      }
    ]
  },
  {
    "category": "API Communication",
    "options": [
      {
        "name": "REST",
        "what": "Architectural style (not a tool/library). Uses HTTP methods (GET/POST/PUT/DELETE) on resource URLs. Returns JSON. Convention-based, no schema enforcement.",
        "strengths": "Universal, simple, cacheable, tooling everywhere",
        "weaknesses": "Over-fetching, no schema contract, versioning is manual",
        "when": "Public APIs, CRUD-heavy, browser clients"
      },
      {
        "name": "gRPC",
        "what": "RPC framework from Google (library + codegen tool). Uses Protocol Buffers for schema and binary serialization. Generates client/server stubs from .proto files. Runs over HTTP/2.",
        "strengths": "Schema (protobuf), streaming, fast binary serialization, codegen",
        "weaknesses": "Not browser-native, harder debugging, requires proto mgmt",
        "when": "Internal service-to-service, low-latency, streaming"
      },
      {
        "name": "GraphQL",
        "what": "Query language + runtime for APIs (server library — Apollo, Yoga, etc.). Clients send queries specifying exactly what fields they want. Single endpoint.",
        "strengths": "Client-driven queries, no over-fetching, single endpoint",
        "weaknesses": "Complexity, N+1 problem, caching harder, authorization complexity",
        "when": "Frontend-driven, multiple clients needing different data shapes"
      }
    ]
  },
  {
    "category": "Identity & Auth",
    "options": [
      {
        "name": "SAML 2.0",
        "what": "XML-based SSO protocol (standard/spec, not a library). IdP sends signed XML assertions to Service Provider via browser redirect. Enterprise-oriented.",
        "strengths": "Enterprise SSO standard, mature, widely supported",
        "weaknesses": "XML-based, complex, not mobile-friendly",
        "when": "Enterprise SSO integration (e.g. connecting to customer IdPs)"
      },
      {
        "name": "OAuth 2.0 / OIDC",
        "what": "Authorization framework (OAuth) + identity layer (OIDC). Both are specs/protocols. Token-based (JWT). Implemented by libraries (Passport.js, Spring Security, etc.).",
        "strengths": "Modern, token-based, mobile-friendly, fine-grained scopes",
        "weaknesses": "Complex grant types, token management",
        "when": "API authorization, social login, SPA/mobile clients"
      },
      {
        "name": "SCIM",
        "what": "REST API spec for automating user provisioning (standard, not a tool). Apps implement the SCIM server endpoint; identity providers push user create/update/delete calls to it.",
        "strengths": "Automated user provisioning/deprovisioning standard",
        "weaknesses": "Inconsistent vendor implementations, limited schema",
        "when": "Syncing employee data to 3rd party apps (core HR/IT platform use case)"
      }
    ]
  },
  {
    "category": "Observability",
    "options": [
      {
        "name": "Prometheus + Grafana",
        "what": "Prometheus: metrics server that scrapes HTTP endpoints on a schedule (you run it). Grafana: dashboard UI (separate server) that queries Prometheus. Both open-source.",
        "strengths": "Open source, pull-based, PromQL, K8s-native, free",
        "weaknesses": "Not for logs/traces, single-node default, needs Thanos for scale",
        "when": "Infrastructure metrics + dashboards on a budget"
      },
      {
        "name": "Datadog",
        "what": "Commercial SaaS observability platform. You install an agent on your servers that ships metrics, logs, and traces to Datadog's cloud. Pay per host/volume.",
        "strengths": "All-in-one (metrics, logs, traces, APM), great UX, easy setup",
        "weaknesses": "Expensive at scale, vendor lock-in",
        "when": "Full-stack observability when budget allows"
      },
      {
        "name": "ELK Stack",
        "what": "Three open-source servers: Logstash (ingest/transform logs) → Elasticsearch (index/search) → Kibana (visualize). You run all three.",
        "strengths": "Powerful log aggregation + search, open source core",
        "weaknesses": "Resource-hungry, complex ops, Elastic license changes",
        "when": "Log aggregation + full-text search on logs"
      },
      {
        "name": "Jaeger / Zipkin",
        "what": "Open-source distributed tracing servers. You instrument services with OpenTelemetry SDK (library), traces are sent to Jaeger/Zipkin for visualization.",
        "strengths": "Distributed tracing, open source, OpenTelemetry compatible",
        "weaknesses": "Just tracing — need separate tools for metrics/logs",
        "when": "Tracing request flow across microservices"
      }
    ]
  },
  {
    "category": "Stream Processing",
    "options": [
      {
        "name": "Kafka Streams",
        "what": "Java library (NOT a server/cluster). Runs inside your application process for stream processing on Kafka topics. No separate infrastructure needed.",
        "strengths": "Library (no cluster), exactly-once, stateful, deploys with app",
        "weaknesses": "JVM only, limited to Kafka input/output",
        "when": "Stateful stream processing tightly coupled to Kafka"
      },
      {
        "name": "Apache Flink",
        "what": "Distributed stream processing framework (cluster: JobManager + TaskManagers). True event-at-a-time processing, not micro-batch. You deploy jobs to the cluster.",
        "strengths": "True streaming, complex event processing, windowing, exactly-once",
        "weaknesses": "Heavy ops, JVM, learning curve",
        "when": "Complex windowing, event-time processing, high-throughput"
      },
      {
        "name": "Spark Streaming",
        "what": "Apache Spark's streaming module (runs on Spark cluster). Processes data in micro-batches. Part of the larger Spark ecosystem (SQL, ML, Graph).",
        "strengths": "Batch + streaming unified, mature ML ecosystem, SQL support",
        "weaknesses": "Micro-batch (not true streaming), higher latency",
        "when": "When you also need batch + ML in same pipeline"
      }
    ]
  },
  {
    "category": "Resilience Patterns",
    "options": [
      {
        "name": "Circuit Breaker",
        "what": "Design pattern (not a standalone tool). Wraps calls to dependencies. Tracks failures — opens circuit to fail fast. Libraries: resilience4j (Java), Polly (.NET). Also built into Envoy/Istio.",
        "strengths": "Prevents cascading failures, fast-fail on degraded deps",
        "weaknesses": "Needs tuning (thresholds, timeout, half-open)",
        "when": "Any call to external/unreliable service (tax APIs, 3rd party)"
      },
      {
        "name": "Rate Limiter",
        "what": "Mechanism to cap request throughput (pattern, not a product). Implemented via Redis + Lua scripts (token bucket / sliding window), or in API gateways (Kong, Envoy).",
        "strengths": "Protects services from abuse, fairness across tenants",
        "weaknesses": "Distributed rate limiting is hard, false positives",
        "when": "API gateway, per-tenant quotas, noisy neighbor prevention"
      },
      {
        "name": "Bulkhead",
        "what": "Design pattern: isolates resources into separate pools (like watertight compartments). Implemented via separate thread pools, connection pools, or container resource limits.",
        "strengths": "Isolates failures to one pool, prevents resource exhaustion",
        "weaknesses": "Under-utilization when idle, sizing is tricky",
        "when": "Separate pools per dependency or tenant tier"
      },
      {
        "name": "Retry + Backoff",
        "what": "Pattern for transient failures (built into most HTTP/gRPC client libraries). Retry after exponentially increasing delays (1s, 2s, 4s...) with random jitter to avoid thundering herd.",
        "strengths": "Handles transient failures gracefully",
        "weaknesses": "Can amplify load (retry storms), needs jitter + cap",
        "when": "Everywhere — always with exponential backoff + jitter"
      }
    ]
  }
] as const;

export const FAILURE_STORIES = [
  {
    "id": "cascade",
    "title": "Cascading Failure",
    "icon": "🔥",
    "scenario": "Downstream tax API returns 500s. Without circuit breakers, every payroll run thread blocks waiting for timeout, exhausting the connection pool.",
    "fix": "Circuit breaker (Hystrix/resilience4j) with fallback: mark those items for manual review + fire alert. Bulkhead pattern to isolate tax-dependent operations from the rest of payroll.",
    "lesson": "Never let one dependency take down the whole system. Fail fast, fail isolated."
  },
  {
    "id": "ordering",
    "title": "Out-of-Order Events",
    "icon": "🔀",
    "scenario": "Employee promoted, then salary updated. Events arrive out of order — payroll processes salary update with old job title, applies wrong tax bracket.",
    "fix": "Partition Kafka by employeeId for per-entity ordering. Consumers process events sequentially per employee. For cross-entity dependencies, use event sequence numbers + idempotent replay.",
    "lesson": "Event ordering is a design choice, not a default. Partition key determines ordering scope."
  },
  {
    "id": "hot_partition",
    "title": "Hot Partition",
    "icon": "🔥",
    "scenario": "Large enterprise tenant (5000 employees) runs payroll simultaneously. Single DB partition gets hammered, response times spike for all tenants.",
    "fix": "Shard by tenant_id. For very large tenants, sub-shard by employee_id range. Dedicated read replicas for heavy tenants. Queue payroll batch jobs with per-tenant concurrency limits.",
    "lesson": "Multi-tenant systems need tenant-aware resource isolation. One tenant's burst shouldn't impact others."
  },
  {
    "id": "stale_cache",
    "title": "Stale Permission Cache",
    "icon": "👻",
    "scenario": "Employee demoted from admin, but cached permissions still show admin role. They access sensitive payroll data for 15 minutes until cache TTL expires.",
    "fix": "Write-through cache invalidation on permission-affecting events. For security-critical permissions, short TTL (30s) + event-driven invalidation. Or: always check permissions from source for admin-level operations.",
    "lesson": "Cache TTL is a security decision, not just a performance one. Security-critical data needs aggressive invalidation."
  },
  {
    "id": "data_loss",
    "title": "Silent Data Loss",
    "icon": "🕳️",
    "scenario": "Kafka consumer commits offset before processing is complete. Consumer crashes mid-batch — those messages are lost forever.",
    "fix": "Process-then-commit pattern. Idempotent consumers so reprocessing is safe. Dead letter queue for poison messages. Reconciliation job that compares source events against downstream state.",
    "lesson": "Exactly-once is a lie. Design for at-least-once with idempotent processing."
  },
  {
    "id": "thundering",
    "title": "Thundering Herd",
    "icon": "🐘",
    "scenario": "Cache for a popular news topic expires. 10K simultaneous requests all miss cache and hit the DB at once, causing cascading latency.",
    "fix": "Cache stampede protection: lock on cache miss so only one request rebuilds. Stale-while-revalidate: serve stale data while async refresh happens. Jittered TTLs to prevent synchronized expiration.",
    "lesson": "Cache expiration at scale is a concurrency problem, not just a freshness problem."
  }
] as const;

export const SHARDING = [
  {
    "pattern": "By tenant_id",
    "when": "Multi-tenant SaaS",
    "example": "Most multi-tenant tables — keeps tenant data co-located",
    "risk": "Large tenant = hot shard"
  },
  {
    "pattern": "By entity_id (hash)",
    "when": "Even distribution needed",
    "example": "Employee records in large tenants",
    "risk": "Cross-shard queries expensive"
  },
  {
    "pattern": "By time",
    "when": "Time-series, logs",
    "example": "Event logs, audit trail, metrics",
    "risk": "Latest partition always hot"
  },
  {
    "pattern": "By geography",
    "when": "Data residency laws",
    "example": "Global payroll (EU data in EU)",
    "risk": "Cross-geo joins impossible"
  },
  {
    "pattern": "Hybrid (tenant+time)",
    "when": "Large tenants + history",
    "example": "Payroll runs: tenant for isolation, period for partitioning",
    "risk": "Complex routing logic"
  }
] as const;

export const DECISION_TREES = {
  "database": {
    "label": "Database",
    "root": {
      "q": "Do you need ACID transactions and complex joins?",
      "options": [
        {
          "label": "Yes, relational",
          "next": {
            "q": "Do you need strong consistency across multiple regions?",
            "options": [
              {
                "label": "Yes, global",
                "answer": {
                  "name": "CockroachDB",
                  "what": "Distributed SQL database (server cluster). PostgreSQL-compatible. Serializable transactions across regions.",
                  "say": "I need strong consistency globally, so I'd use CockroachDB — distributed SQL inspired by Spanner, gives me serializable transactions across regions while staying Postgres-compatible."
                }
              },
              {
                "label": "No, single region",
                "answer": {
                  "name": "PostgreSQL",
                  "what": "Open-source relational database server. ACID, JSONB support, extensible via plugins.",
                  "say": "Postgres is my go-to — ACID transactions, rich query support, JSONB for semi-structured data. I'd add read replicas for scaling reads."
                }
              }
            ]
          }
        },
        {
          "label": "No, flexible schema",
          "next": {
            "q": "Is the workload write-heavy or read-heavy?",
            "options": [
              {
                "label": "Write-heavy, append-mostly",
                "answer": {
                  "name": "Cassandra",
                  "what": "Open-source wide-column store. Peer-to-peer, no single leader. Linear write scaling across nodes and data centers.",
                  "say": "Write-heavy with no complex queries, so Cassandra — scales writes linearly, multi-DC replication natively. Trade-off: no joins, eventual consistency."
                }
              },
              {
                "label": "Read-heavy, flexible queries",
                "answer": {
                  "name": "MongoDB",
                  "what": "Open-source document database. JSON-like documents, secondary indexes, aggregation pipeline.",
                  "say": "Schema is evolving, queries are varied — MongoDB. Flexible document model, secondary indexes for reads, aggregation pipeline for analytics."
                }
              }
            ]
          }
        },
        {
          "label": "Simple key → value lookups",
          "answer": {
            "name": "DynamoDB / Redis",
            "what": "DynamoDB: AWS managed key-value (serverless). Redis: in-memory data structure store (server). Both single-digit-ms reads.",
            "say": "Simple key-value access — DynamoDB for persistence or Redis if it fits in memory. Both give single-digit ms. DynamoDB if managed, Redis if I need sorted sets."
          }
        }
      ]
    }
  },
  "queue": {
    "label": "Message queue",
    "root": {
      "q": "Do you need to replay messages or maintain strict ordering?",
      "options": [
        {
          "label": "Yes, replay + ordering",
          "answer": {
            "name": "Kafka",
            "what": "Distributed event streaming platform (broker cluster). Ordered per-partition, durable log with replay.",
            "say": "I need ordering by entity and replay, so Kafka — partition by entity ID for per-entity ordering. The durable log gives me an audit trail for free."
          }
        },
        {
          "label": "No, just async task dispatch",
          "next": {
            "q": "Do you need complex routing rules (priority, fan-out)?",
            "options": [
              {
                "label": "Yes, complex routing",
                "answer": {
                  "name": "RabbitMQ",
                  "what": "Open-source message broker (server). AMQP protocol with exchanges, queues, and bindings for flexible routing.",
                  "say": "I need priority queues and topic-based routing — RabbitMQ's exchange + binding model lets me route messages to different consumers based on attributes."
                }
              },
              {
                "label": "No, simple queue",
                "answer": {
                  "name": "SQS",
                  "what": "AWS managed message queue (serverless). Standard: best-effort order. FIFO: exactly-once. Built-in DLQ.",
                  "say": "Simple async work queue — SQS is lowest-ops. Managed, scales to zero, built-in DLQ. Don't need Kafka's complexity here."
                }
              }
            ]
          }
        }
      ]
    }
  },
  "cache": {
    "label": "Cache",
    "root": {
      "q": "Do you need data structures beyond simple key-value?",
      "options": [
        {
          "label": "Yes (sorted sets, pub/sub, etc.)",
          "answer": {
            "name": "Redis",
            "what": "In-memory data structure store (server). Strings, hashes, lists, sets, sorted sets, streams. Lua scripting. Clusterable.",
            "say": "I need sorted sets for ranking and pub/sub for invalidation, so Redis. Also my rate limiter — token bucket with Lua script atomically."
          }
        },
        {
          "label": "No, pure key → value",
          "answer": {
            "name": "Memcached",
            "what": "In-memory key-value cache (server). Multi-threaded. Just key → value with TTL. Simpler than Redis.",
            "say": "Pure read-through cache — Memcached is simpler and multi-threaded, slightly better throughput for basic caching."
          }
        },
        {
          "label": "Do I even need a cache?",
          "answer": {
            "name": "Maybe not",
            "what": "If your DB handles the read load with replicas, skip the cache. Caching adds invalidation complexity.",
            "say": "Let me check the numbers — at this QPS, Postgres with read replicas might handle it. I'll add cache only if reads become a bottleneck."
          }
        }
      ]
    }
  },
  "api": {
    "label": "API protocol",
    "root": {
      "q": "Who is the consumer of this API?",
      "options": [
        {
          "label": "Browser / public clients",
          "answer": {
            "name": "REST (HTTP + JSON)",
            "what": "Architectural convention using HTTP methods on resource URLs. Not a library — just a pattern. JSON. Cacheable.",
            "say": "Public-facing for browser clients — REST. Universally supported, cacheable via CDN, every client knows JSON over HTTP."
          }
        },
        {
          "label": "Internal services (backend-to-backend)",
          "answer": {
            "name": "gRPC",
            "what": "RPC framework from Google (library + codegen). Protocol Buffers for schema + binary serialization. HTTP/2.",
            "say": "Internal service-to-service — gRPC. Binary serialization is faster, protobuf schema is a contract between teams, streaming for free."
          }
        },
        {
          "label": "Multiple frontends, different data needs",
          "answer": {
            "name": "GraphQL",
            "what": "Query language + server runtime (Apollo, Yoga). Single endpoint. Clients specify exactly which fields they need.",
            "say": "Multiple clients — mobile needs fewer fields, web needs more — GraphQL lets each request exactly what it needs. Trade-off: N+1 and caching is harder."
          }
        }
      ]
    }
  },
  "search": {
    "label": "Search",
    "root": {
      "q": "What kind of search do you need?",
      "options": [
        {
          "label": "Full-text + aggregations + facets",
          "answer": {
            "name": "Elasticsearch",
            "what": "Distributed search engine on Lucene (cluster of nodes). Inverted index for fast text lookup. REST API.",
            "say": "Full-text with faceted filtering and aggregations — Elasticsearch. Built on inverted indices, handles aggregation queries for dashboards."
          }
        },
        {
          "label": "Simple instant search, typo-tolerant",
          "answer": {
            "name": "Typesense",
            "what": "Open-source search engine (single binary, C++). Typo-tolerant by default. Much simpler to operate than ES.",
            "say": "Simple search — Typesense is lighter than ES. Typo-tolerant out of the box, single binary, don't need ES's aggregation power."
          }
        },
        {
          "label": "Just filtering on columns",
          "answer": {
            "name": "Your primary DB",
            "what": "Filtering on indexed columns doesn't need a search engine. Composite index in Postgres covers it.",
            "say": "Just filtering on indexed columns — don't need a search engine. Composite index on (category, created_at) in Postgres covers this."
          }
        }
      ]
    }
  },
  "storage": {
    "label": "Object storage",
    "root": {
      "q": "What are you storing?",
      "options": [
        {
          "label": "Files / media / backups",
          "next": {
            "q": "Any data residency or on-prem requirements?",
            "options": [
              {
                "label": "No, cloud is fine",
                "answer": {
                  "name": "S3 (or GCS)",
                  "what": "AWS S3: managed object storage, serverless, 11 nines durability. GCS: Google equivalent, strong read-after-write consistency.",
                  "say": "Binary files go in S3 — 11 nines durability, lifecycle policies for cost, S3 event notifications for processing triggers."
                }
              },
              {
                "label": "Yes, on-prem / sovereignty",
                "answer": {
                  "name": "MinIO",
                  "what": "Open-source S3-compatible object storage server. You run it on your hardware. Written in Go.",
                  "say": "Data sovereignty requirement — MinIO gives me S3-compatible API running in our own data center."
                }
              }
            ]
          }
        },
        {
          "label": "Structured data that needs queries",
          "answer": {
            "name": "Use a database",
            "what": "Object stores are for blobs fetched by key. If you need queries, filters, joins, it belongs in a DB.",
            "say": "Queryable structured data belongs in a database. I'd only put raw files in S3 and metadata in Postgres."
          }
        }
      ]
    }
  },
  "observability": {
    "label": "Observability",
    "root": {
      "q": "What's your primary observability need?",
      "options": [
        {
          "label": "Metrics + dashboards",
          "answer": {
            "name": "Prometheus + Grafana",
            "what": "Prometheus: metrics server, scrapes HTTP endpoints (you run it). Grafana: dashboard UI (separate server). Both open-source.",
            "say": "Metrics and dashboards — Prometheus + Grafana. Standard for K8s, PromQL is powerful, free. Add Thanos for long-term storage."
          }
        },
        {
          "label": "Log aggregation + search",
          "answer": {
            "name": "ELK Stack",
            "what": "Logstash (ingest) → Elasticsearch (index/search) → Kibana (visualize). Three servers you run. Open-source core.",
            "say": "Log aggregation — ELK. Logstash for ingestion, Elasticsearch for indexing, Kibana for visualization. Loki is lighter if cost matters."
          }
        },
        {
          "label": "Distributed tracing",
          "answer": {
            "name": "Jaeger + OpenTelemetry",
            "what": "OpenTelemetry: SDK added to your code (library). Jaeger: server that collects and visualizes traces.",
            "say": "Tracing across microservices — instrument with OpenTelemetry SDK, send to Jaeger. Shows exactly where latency spikes in multi-service calls."
          }
        },
        {
          "label": "All of the above, managed",
          "answer": {
            "name": "Datadog",
            "what": "Commercial SaaS. Install an agent, ships metrics + logs + traces to Datadog cloud. All-in-one but expensive.",
            "say": "Budget allows it — Datadog for metrics, logs, traces, APM in one platform. Trade-off: expensive at scale."
          }
        }
      ]
    }
  },
  "resilience": {
    "label": "Resilience",
    "root": {
      "q": "What failure mode are you protecting against?",
      "options": [
        {
          "label": "Downstream service slow/down",
          "answer": {
            "name": "Circuit breaker",
            "what": "Design pattern. Libraries: resilience4j (Java), Polly (.NET). Also built into Envoy/Istio. Opens after N failures, fails fast.",
            "say": "External API could go down — circuit breaker. After N failures, opens and fails fast instead of blocking threads. resilience4j or Envoy config."
          }
        },
        {
          "label": "One tenant overwhelming system",
          "answer": {
            "name": "Rate limiter + bulkhead",
            "what": "Rate limiter: token bucket via Redis + Lua, or API gateway. Bulkhead: separate resource pools per tenant tier.",
            "say": "Noisy neighbor — rate limit per tenant at gateway (sliding window in Redis), bulkhead with separate connection pools so one tenant can't starve others."
          }
        },
        {
          "label": "Transient network errors",
          "answer": {
            "name": "Retry + exponential backoff",
            "what": "Built into most HTTP/gRPC client libraries. Increasing delays with random jitter to prevent thundering herd.",
            "say": "Transient failures — retry with exponential backoff and jitter. Without jitter, all retries spike at the same time."
          }
        },
        {
          "label": "Cascading failure across services",
          "answer": {
            "name": "All three + degradation",
            "what": "Circuit breakers per dependency + rate limits per tenant + retries + graceful degradation plan.",
            "say": "Layer all three: circuit breaker per call, rate limiter at gateway, retry with backoff. Plus degradation — if ranking is down, serve cached or chronological feed."
          }
        }
      ]
    }
  },
  "backend": {
    "label": "Backend framework",
    "root": {
      "q": "What's the primary job of this service?",
      "options": [
        {
          "label": "Simple API — CRUD, read/write, serve data",
          "next": {
            "q": "Do you need an ORM, admin panel, auth, and a full ecosystem?",
            "options": [
              {
                "label": "Yes, full-featured",
                "answer": {
                  "name": "Django",
                  "what": "Python web framework (library). Batteries-included: ORM, admin, auth, migrations, middleware. Runs as a WSGI/ASGI app behind NGINX/Gunicorn. Used by many large Django shops.",
                  "say": "Full-featured app with ORM and admin — Django. Batteries-included, mature ecosystem, proven at scale. Trade-off: heavier than micro-frameworks."
                }
              },
              {
                "label": "No, lightweight and fast",
                "answer": {
                  "name": "FastAPI",
                  "what": "Python async web framework (library). Type hints for auto-validation, auto-generated OpenAPI docs. Runs on Uvicorn (ASGI). Very fast for I/O-bound services.",
                  "say": "Lightweight service — FastAPI. Async by default, auto-generates API docs from type hints, great for I/O-bound microservices. Trade-off: no built-in ORM or admin."
                }
              }
            ]
          }
        },
        {
          "label": "High-throughput, low-latency microservice",
          "next": {
            "q": "What language is the team strongest in?",
            "options": [
              {
                "label": "Python",
                "answer": {
                  "name": "FastAPI",
                  "what": "Python async framework (library). Built on Starlette + Pydantic. Auto-generates OpenAPI docs. Runs on Uvicorn.",
                  "say": "Need low latency in Python — FastAPI with Uvicorn. Async I/O handles concurrent requests well. For CPU-bound work, I'd switch to Go."
                }
              },
              {
                "label": "Go",
                "answer": {
                  "name": "Go net/http or Gin",
                  "what": "Go's standard library has a production-ready HTTP server. Gin adds routing + middleware on top. Compiled binary, no runtime. Very low latency.",
                  "say": "Latency-critical service — I'd write it in Go. Compiled binary, minimal memory footprint, goroutines handle concurrency natively. Gin for routing if I want a framework."
                }
              },
              {
                "label": "Java/Kotlin",
                "answer": {
                  "name": "Spring Boot",
                  "what": "Java/Kotlin framework (library). Enterprise-grade: dependency injection, security, data access. Runs as a JAR on JVM.",
                  "say": "Java shop or enterprise environment — Spring Boot. Mature ecosystem, great for complex domain logic. Trade-off: heavier startup, more boilerplate."
                }
              }
            ]
          }
        },
        {
          "label": "Internal gRPC service (service-to-service)",
          "answer": {
            "name": "Go or gRPC-native framework",
            "what": "gRPC is a framework, not a language. But Go has first-class gRPC support with protobuf codegen. Python gRPC works too but slower.",
            "say": "Internal gRPC service — I'd use Go for performance or Python if the team prefers. Either way, define the .proto contract first, generate stubs, implement the server."
          }
        },
        {
          "label": "Quick prototype / webhook handler",
          "answer": {
            "name": "Flask or Express",
            "what": "Flask: Python micro-framework (library). Minimal — just routing + request handling. Express: same idea for Node.js. Both ~50 lines for a working API.",
            "say": "Just a quick service or webhook handler — Flask if Python, Express if Node. Get it running in an hour, migrate to something sturdier later if it grows."
          }
        }
      ]
    }
  },
  "ml_infra": {
    "label": "ML inference",
    "root": {
      "q": "How often does the model retrain?",
      "options": [
        {
          "label": "Rarely (monthly or less)",
          "next": {
            "q": "How many models are you serving?",
            "options": [
              {
                "label": "1-2 models",
                "answer": {
                  "name": "FastAPI on ECS/K8s",
                  "what": "Wrap model in a FastAPI endpoint, containerize, deploy on ECS or K8s. Load model into memory on startup. Simple and cheap.",
                  "say": "Model retrains monthly, just one or two models — I'd wrap it in FastAPI, containerize, deploy on ECS. SageMaker is overkill. I retrain offline, test manually, and redeploy the container."
                }
              },
              {
                "label": "Many models / need registry",
                "answer": {
                  "name": "MLflow + FastAPI",
                  "what": "MLflow: open-source model registry (server). Tracks experiments, versions models, stores artifacts. Serve via FastAPI or MLflow's built-in serving.",
                  "say": "Multiple models but infrequent retraining — MLflow for the registry and versioning, serve via FastAPI. Gives me model lineage and rollback without the full SageMaker cost."
                }
              }
            ]
          }
        },
        {
          "label": "Regularly (daily/weekly) on new data",
          "next": {
            "q": "How high-stakes is a bad model output?",
            "options": [
              {
                "label": "High stakes (fraud, payments, medical)",
                "answer": {
                  "name": "SageMaker / Vertex AI (full MLOps)",
                  "what": "AWS SageMaker or GCP Vertex AI: managed training, model registry, A/B endpoints, monitoring. Full pipeline: train → evaluate → gate → shadow → canary → deploy.",
                  "say": "High-stakes, frequent retraining — SageMaker with the full pipeline. Automated evaluation gates so a bad model can't reach production. Shadow mode first, then canary at 5%, then full rollout."
                }
              },
              {
                "label": "Medium stakes (ranking, recs, search)",
                "answer": {
                  "name": "SageMaker endpoints or Seldon",
                  "what": "SageMaker inference endpoints for managed scaling, or Seldon Core on K8s for open-source alternative. A/B testing between model versions.",
                  "say": "Medium stakes, weekly retraining — SageMaker endpoints with A/B testing between model versions. Or Seldon on K8s if I want to avoid vendor lock-in. I need to measure engagement impact, not just accuracy."
                }
              },
              {
                "label": "Low stakes (content recs, dedup)",
                "answer": {
                  "name": "FastAPI + simple CI/CD",
                  "what": "Retrain in a batch job, evaluate offline, deploy new container if metrics pass. No need for shadow/canary at this risk level.",
                  "say": "Low stakes — retrain in a batch job, run offline eval, if metrics pass then deploy the new container. Start simple, add MLOps tooling when the model count or risk level justifies it."
                }
              }
            ]
          }
        },
        {
          "label": "Real-time / online learning",
          "answer": {
            "name": "Feature store + streaming inference",
            "what": "Feast or Tecton for real-time feature serving. Model serves from a low-latency endpoint (SageMaker, TorchServe). Features computed from Kafka stream.",
            "say": "Online learning — I'd use a feature store like Feast for real-time feature serving, Kafka Streams for feature computation, and a low-latency inference endpoint. The model continuously updates on fresh features."
          }
        }
      ]
    }
  },
  "batch_jobs": {
    "label": "Batch jobs",
    "root": {
      "q": "How complex is the job?",
      "options": [
        {
          "label": "Single recurring task (run X every hour)",
          "next": {
            "q": "What's your compute environment?",
            "options": [
              {
                "label": "K8s / EKS",
                "answer": {
                  "name": "K8s CronJob",
                  "what": "Built-in K8s resource. Define a container + schedule (cron syntax). K8s handles scheduling, retries, and cleanup. No extra tooling.",
                  "say": "Simple hourly job on K8s — CronJob. Define the container and schedule, done. No orchestration framework needed for a single recurring task."
                }
              },
              {
                "label": "AWS native / serverless",
                "answer": {
                  "name": "EventBridge + Lambda (or Step Functions)",
                  "what": "EventBridge: AWS cron scheduler (managed). Triggers Lambda on schedule. Step Functions if the job has 2-3 steps that need sequencing.",
                  "say": "AWS native — EventBridge triggers a Lambda on a cron schedule. If there are a few steps in sequence, Step Functions chains them. Fully managed, no servers."
                }
              },
              {
                "label": "Django app (Python)",
                "answer": {
                  "name": "Celery Beat",
                  "what": "Celery's built-in periodic task scheduler (library). Define tasks in Python, schedule with cron syntax. Needs a broker (Redis/RabbitMQ). Runs as a worker process.",
                  "say": "Already in Django — Celery Beat for periodic tasks. Define the schedule in Python, runs alongside the app. No extra infra beyond the Redis broker we already have."
                }
              }
            ]
          }
        },
        {
          "label": "Multi-step pipeline with dependencies",
          "next": {
            "q": "Do steps need to wait for each other, retry independently, or branch?",
            "options": [
              {
                "label": "Yes, complex DAG with branching",
                "answer": {
                  "name": "Airflow (or MWAA on AWS)",
                  "what": "Open-source workflow orchestrator (server). Define DAGs in Python. Each task is a unit of work. Handles retries, dependencies, scheduling, monitoring. MWAA is AWS-managed Airflow.",
                  "say": "Complex DAG with branching and dependencies — Airflow. Define the pipeline in Python, get retries, monitoring, and dependency management for free. MWAA if I want managed on AWS."
                }
              },
              {
                "label": "Sequential steps, need durability",
                "answer": {
                  "name": "Temporal",
                  "what": "Open-source durable execution platform (server cluster). Write workflows as code. Handles retries, state persistence, and recovery across failures. Supports long-running workflows.",
                  "say": "Multi-step with durability needs — Temporal. Workflows as code, durable state across failures, built-in retry and timeout handling. Better than Step Functions for complex business logic."
                }
              },
              {
                "label": "Simple chain of 2-3 steps",
                "answer": {
                  "name": "Step Functions",
                  "what": "AWS managed state machine service (serverless). Define steps in JSON (ASL). Integrates with Lambda, ECS, SQS. Visual debugger.",
                  "say": "Just 2-3 steps in sequence — Step Functions. Quick to set up, visual debugger, fully managed. I'd only graduate to Airflow or Temporal if the pipeline gets more complex."
                }
              }
            ]
          }
        },
        {
          "label": "Data processing / ETL at scale",
          "answer": {
            "name": "Spark (EMR / Glue) or dbt",
            "what": "Spark on EMR: distributed data processing for large datasets. AWS Glue: managed Spark ETL. dbt: SQL-based transformations if your data is in a warehouse.",
            "say": "Large-scale ETL — Spark on EMR for heavy transforms, or dbt if the data is already in a warehouse and transforms are SQL-expressible. Glue if I want managed Spark without cluster ops."
          }
        }
      ]
    }
  }
} as const;

export const GAME_STEPS = [
  {
    "num": "01",
    "label": "Product Frame",
    "prompt": "\"Let me make sure I understand the product.\" State the user, the problem, the value. 30 seconds."
  },
  {
    "num": "02",
    "label": "Clarifying Questions",
    "prompt": "Ask 3-5 pointed questions. Not generic. Who's the user? Read-to-write ratio? Multi-tenant? Consistency needs? Compliance?"
  },
  {
    "num": "03",
    "label": "Commit a Scope",
    "prompt": "\"Here's what I'll focus on in 45 minutes.\" Pick a spine. Say what you're NOT covering and why."
  },
  {
    "num": "04",
    "label": "Roadmap Your Answer",
    "prompt": "\"I'll start with the data model, then APIs, then high-level architecture, then I want to go deep on [X].\""
  }
] as const;

export const GAME_TIME_BUDGET = [
  {
    "phase": "Requirements & Scoping",
    "min": 8,
    "max": 10,
    "tip": "Ask clarifying Qs, state functional + non-functional reqs, commit scope"
  },
  {
    "phase": "API & Data Model",
    "min": 5,
    "max": 8,
    "tip": "Key entities, relationships, storage choice + justification, shard key"
  },
  {
    "phase": "High-Level Architecture",
    "min": 12,
    "max": 15,
    "tip": "Draw it on the whiteboard. Walk through data flow. Name technologies."
  },
  {
    "phase": "Deep Dive",
    "min": 12,
    "max": 15,
    "tip": "Pick the hardest component. Trade-offs, failure modes, alternatives."
  },
  {
    "phase": "Scaling & Fault Tolerance",
    "min": 8,
    "max": 10,
    "tip": "Bottlenecks, sharding, replication, what breaks at 100x, monitoring"
  },
  {
    "phase": "Wrap-up / Q&A",
    "min": 3,
    "max": 5,
    "tip": "Own your weaknesses. \"If I had more time I'd improve X.\""
  }
] as const;

export const GAME_SIGNALS = [
  {
    "icon": "⚡",
    "signal": "Drive the interview",
    "detail": "Don't wait for prompts. Propose where to go next. \"I want to dig into the ranking pipeline — that's where the interesting trade-offs are.\"",
    "level": "STAFF+ CRITICAL"
  },
  {
    "icon": "?",
    "signal": "Ask basic questions first",
    "detail": "Don't skip the obvious: scale (users, QPS), read/write ratio, latency targets, consistency model. These inform every tech choice downstream.",
    "level": "TABLE STAKES"
  },
  {
    "icon": "◈",
    "signal": "Functional + Non-functional",
    "detail": "Cover both explicitly. Functional = what the system does. Non-functional = scale, availability, latency, consistency, security, compliance.",
    "level": "TABLE STAKES"
  },
  {
    "icon": "◇",
    "signal": "Think out loud",
    "detail": "Narrate your reasoning. \"I'm choosing Kafka over SQS here because I need ordered replay for dedup...\" Don't just draw boxes.",
    "level": "TABLE STAKES"
  },
  {
    "icon": "⏱",
    "signal": "Manage your time",
    "detail": "60 minutes is tight. If you spend 20 min on requirements, you've lost. Follow the time budget below.",
    "level": "TABLE STAKES"
  },
  {
    "icon": "△",
    "signal": "Discuss trade-offs",
    "detail": "For every choice, name what you're giving up. \"I'd use eventual consistency here — we trade freshness for availability, which is acceptable because...\"",
    "level": "SENIOR+"
  }
] as const;

export const MON_TEMPLATE = {
  "formula": "\"The thing I care about most is [business metric]. The earliest signal it's about to degrade is [leading indicator], because when [leading indicator] drops, it causes [chain], which eventually hits [business metric]. I'd page on [leading indicator] crossing [threshold] so we can act before users are affected.\"",
  "layers": [
    {
      "name": "Business",
      "desc": "The metric the CEO cares about. Revenue, SLA compliance, engagement. If this goes red, the company is hurting.",
      "example": "SLA compliance rate, checkout conversion rate, feed freshness"
    },
    {
      "name": "Service",
      "desc": "Is my service doing its job? Error rates, latency, throughput at the API/service boundary.",
      "example": "Payment API 5xx rate, auto-verification pass rate, feed generation p95 latency"
    },
    {
      "name": "Infra",
      "desc": "Are the resources healthy? DB, cache, queue, CPU. You'd monitor these even without knowing what the service does.",
      "example": "DB query latency, cache hit ratio, queue depth, CPU utilization, connection pool usage"
    },
    {
      "name": "Leading Indicator",
      "desc": "The metric ONE STEP UPSTREAM of the failure. Gets worse BEFORE the thing you care about gets worse. Gives you time to act.",
      "example": "Cart abandonment at payment step (before payment failures), auto-verify pass rate (before SLA breaches), aggregator processing time (before stale feeds)"
    }
  ],
  "externalDeps": "For EVERY external dependency call: monitor error rate, timeout rate, and p95 latency independently. Timeouts are the silent killer — they hold threads while errors fail fast."
} as const;

export const MON_DRILLS = [
  {
    "system": "Payroll Processing",
    "business": "Payroll completion rate — % of employees paid on time this cycle",
    "service": "Batch job duration — if it takes 3 hours instead of 1, you're in trouble",
    "infra": "DB write latency, queue depth of unprocessed records",
    "leading": "Batch processing rate (records/min). If slowing mid-run → won't finish before pay deadline",
    "chain": "Processing rate drops → batch won't finish on time → employees miss paycheck"
  },
  {
    "system": "E-commerce Checkout",
    "business": "Checkout conversion rate — users who start checkout vs complete payment",
    "service": "Payment API error rate (5xx only), p95 payment latency",
    "infra": "Payment gateway timeout rate, DB write latency on order creation",
    "leading": "Cart abandonment rate at payment step. Users give up before errors are logged.",
    "chain": "Abandonment spikes → payment failures rise → revenue drops"
  },
  {
    "system": "Document Verification",
    "business": "SLA compliance rate — % of docs verified within SLA window",
    "service": "Auto-verification pass rate. If drops from 40% to 5%, manual queue floods.",
    "infra": "Queue depth, reviewer assignment latency",
    "leading": "Auto-verification pass rate. Drops → manual queue floods → reviewers overwhelmed → SLA breaches",
    "chain": "Auto-verify rate drops → manual queue floods → SLA failures spike hours later"
  },
  {
    "system": "News Aggregator",
    "business": "Feed freshness — average age of articles on homepage (not engagement — too broad)",
    "service": "Cache hit ratio. Drop → DB and ranker flooded → latency spikes",
    "infra": "DynamoDB throttling rate, ranking inference latency/timeouts",
    "leading": "Aggregator processing time. If dedup/ingestion slows → stale articles → feed freshness degrades",
    "chain": "Aggregator slows → articles arrive late → feed goes stale → users see old news"
  }
] as const;
