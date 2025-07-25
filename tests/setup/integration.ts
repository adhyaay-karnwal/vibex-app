// Mock Redis before any imports
import { vi } from "vitest";

vi.mock("redis", () => ({
	createClient: vi.fn(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn().mockResolvedValue("OK"),
		del: vi.fn().mockResolvedValue(1),
		exists: vi.fn().mockResolvedValue(0),
		expire: vi.fn().mockResolvedValue(1),
		ttl: vi.fn().mockResolvedValue(-1),
		ping: vi.fn().mockResolvedValue("PONG"),
		on: vi.fn(),
		off: vi.fn(),
	})),
}));

vi.mock("ioredis", () => ({
	default: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn().mockResolvedValue("OK"),
		del: vi.fn().mockResolvedValue(1),
		exists: vi.fn().mockResolvedValue(0),
		expire: vi.fn().mockResolvedValue(1),
		ttl: vi.fn().mockResolvedValue(-1),
		ping: vi.fn().mockResolvedValue("PONG"),
		on: vi.fn(),
		off: vi.fn(),
	})),
}));
// Create a reusable mock database object
const createMockDb = () => {
	const mockDb: any = {
		select: vi.fn(() => mockDb),
		where: vi.fn(() => mockDb),
		orderBy: vi.fn(() => mockDb),
		limit: vi.fn(() => mockDb),
		insert: vi.fn((table) => mockDb),
		values: vi.fn().mockImplementation(async () => {
			// Return successful insert
			return { rowCount: 1 };
		}),
		update: vi.fn((table) => mockDb),
		set: vi.fn(() => mockDb),
		delete: vi.fn((table) => mockDb),
		execute: vi.fn().mockResolvedValue([]),
	};

	// Add from method with special handling for migrations table
	mockDb.from = vi.fn().mockImplementation((table: any) => {
		// If querying migrations table, setup specific behavior
		if (table?.name === "migrations" || table?._?.name === "migrations") {
			mockDb.execute = vi.fn().mockResolvedValue([]);
			mockDb.orderBy = vi.fn(() => mockDb);
			mockDb.limit = vi.fn().mockResolvedValue([]);
		}
		return mockDb;
	});

	return mockDb;
};

// Mock database modules before any other imports
vi.mock("@neondatabase/serverless", () => ({
	neon: vi.fn(() => {
		// Create a mock SQL function that handles both template literal and direct string calls
		const mockSql = vi.fn().mockImplementation(async (query: any, ...params: any[]) => {
			// Handle template literal calls
			if (Array.isArray(query)) {
				const queryStr = query[0];
				if (queryStr === "SELECT 1") {
					return [{ "?column?": 1 }];
				}
				if (queryStr === "SELECT 1 as value") {
					return [{ value: 1 }];
				}
				if (queryStr.includes("SELECT current_timestamp")) {
					return [{ now: new Date().toISOString() }];
				}
				if (queryStr === "BEGIN" || queryStr === "COMMIT" || queryStr === "ROLLBACK") {
					return [];
				}
				if (queryStr === "ANALYZE") {
					return [];
				}
			}

			// Handle direct string queries
			if (typeof query === "string") {
				// For migration-related queries
				if (
					query.includes("pg_indexes") ||
					query.includes("pg_tables") ||
					query.includes("pg_stat_") ||
					query.includes("pg_extension") ||
					query.includes("information_schema")
				) {
					return [];
				}
				// For CREATE INDEX, CREATE EXTENSION etc.
				if (
					query.toLowerCase().includes("create") ||
					query.toLowerCase().includes("drop") ||
					query.toLowerCase().includes("alter") ||
					query.toLowerCase().includes("vacuum") ||
					query.toLowerCase().includes("reindex")
				) {
					return [];
				}
			}

			return [];
		});

		// Make the SQL function callable as a template literal tag
		Object.setPrototypeOf(mockSql, Function.prototype);

		return mockSql;
	}),
	neonConfig: {
		fetchConnectionCache: true,
	},
}));

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
	desc: vi.fn((column) => ({ type: "desc", column })),
	asc: vi.fn((column) => ({ type: "asc", column })),
	eq: vi.fn((a, b) => ({ type: "eq", a, b })),
	ne: vi.fn((a, b) => ({ type: "ne", a, b })),
	gt: vi.fn((a, b) => ({ type: "gt", a, b })),
	gte: vi.fn((a, b) => ({ type: "gte", a, b })),
	lt: vi.fn((a, b) => ({ type: "lt", a, b })),
	lte: vi.fn((a, b) => ({ type: "lte", a, b })),
	and: vi.fn((...conditions) => ({ type: "and", conditions })),
	or: vi.fn((...conditions) => ({ type: "or", conditions })),
	sql: vi.fn((strings, ...values) => ({ type: "sql", strings, values })),
	relations: vi.fn((table, relationsFn) => {
		// Mock relations function
		const mockRelations = {
			one: vi.fn(() => ({})),
			many: vi.fn(() => ({})),
		};
		const result = relationsFn(mockRelations);
		return { table, relations: result };
	}),
}));

// Mock drizzle-orm/pg-core
vi.mock("drizzle-orm/pg-core", () => {
	// Create chainable column mock
	const createColumn = (type: string, name: string) => {
		const column: any = { type, name };
		column.primaryKey = vi.fn(() => column);
		column.notNull = vi.fn(() => column);
		column.default = vi.fn(() => column);
		column.defaultNow = vi.fn(() => column);
		column.defaultRandom = vi.fn(() => column);
		column.references = vi.fn(() => column);
		column.onDelete = vi.fn(() => column);
		column.onUpdate = vi.fn(() => column);
		column.$type = vi.fn(() => column);
		column.unique = vi.fn(() => column);
		return column;
	};

	return {
		pgTable: vi.fn((name, columns, config) => ({
			name,
			columns,
			config,
			_: { name },
		})),
		boolean: vi.fn((name) => createColumn("boolean", name)),
		foreignKey: vi.fn((config) => ({ type: "foreignKey", config })),
		index: vi.fn((name) => ({ type: "index", name })),
		integer: vi.fn((name) => createColumn("integer", name)),
		jsonb: vi.fn((name) => createColumn("jsonb", name)),
		text: vi.fn((name) => createColumn("text", name)),
		timestamp: vi.fn((name) => createColumn("timestamp", name)),
		unique: vi.fn((name) => ({ type: "unique", name })),
		uuid: vi.fn((name) => createColumn("uuid", name)),
		varchar: vi.fn((name, config) => createColumn("varchar", name)),
		vector: vi.fn((name, config) => createColumn("vector", name)),
	};
});

// Mock the db/config module directly
vi.mock("../../db/config", () => {
	const mockDb = createMockDb();
	const mockSql = vi.fn().mockImplementation(async (query: any, ...params: any[]) => {
		if (Array.isArray(query) && query[0] === "SELECT 1") {
			return [{ "?column?": 1 }];
		}
		return [];
	});

	return {
		db: mockDb,
		sql: mockSql,
		checkDatabaseHealth: vi.fn().mockResolvedValue(true),
		DatabasePool: vi.fn().mockImplementation(() => ({
			getInstance: vi.fn().mockReturnThis(),
			getConnection: vi.fn().mockResolvedValue(mockSql),
			releaseConnection: vi.fn(),
			getConnectionCount: vi.fn().mockReturnValue(0),
			getMaxConnections: vi.fn().mockReturnValue(20),
			isConnectionPoolHealthy: vi.fn().mockReturnValue(true),
			getLastHealthCheck: vi.fn().mockReturnValue(new Date()),
			getPoolStats: vi.fn().mockReturnValue({
				activeConnections: 0,
				maxConnections: 20,
				utilizationPercent: 0,
				isHealthy: true,
				lastHealthCheck: new Date(),
			}),
			destroy: vi.fn(),
		})),
		DatabaseMonitor: vi.fn().mockImplementation(() => ({
			getInstance: vi.fn().mockReturnThis(),
			recordQuery: vi.fn(),
			recordError: vi.fn(),
			getMetrics: vi.fn().mockReturnValue({
				queryCount: 0,
				errorCount: 0,
				averageResponseTime: 0,
				errorRate: 0,
				slowQueries: [],
			}),
			resetMetrics: vi.fn(),
		})),
		dbConfig: {
			connectionString: "postgresql://test:test@localhost:5432/test",
			ssl: false,
			maxConnections: 20,
			idleTimeout: 30_000,
			connectionTimeout: 10_000,
		},
		initializeExtensions: vi.fn().mockResolvedValue(undefined),
	};
});

// Also mock at the relative path used by migration runner
vi.mock("../../../db/config", () => {
	const mockDb = createMockDb();
	const mockSql = vi.fn().mockImplementation(async (query: any, ...params: any[]) => {
		if (Array.isArray(query) && query[0] === "SELECT 1") {
			return [{ "?column?": 1 }];
		}
		return [];
	});

	return {
		db: mockDb,
		sql: mockSql,
		checkDatabaseHealth: vi.fn().mockResolvedValue(true),
		DatabasePool: vi.fn().mockImplementation(() => ({
			getInstance: vi.fn().mockReturnThis(),
			getConnection: vi.fn().mockResolvedValue(mockSql),
			releaseConnection: vi.fn(),
			getConnectionCount: vi.fn().mockReturnValue(0),
			getMaxConnections: vi.fn().mockReturnValue(20),
			isConnectionPoolHealthy: vi.fn().mockReturnValue(true),
			getLastHealthCheck: vi.fn().mockReturnValue(new Date()),
			getPoolStats: vi.fn().mockReturnValue({
				activeConnections: 0,
				maxConnections: 20,
				utilizationPercent: 0,
				isHealthy: true,
				lastHealthCheck: new Date(),
			}),
			destroy: vi.fn(),
		})),
		DatabaseMonitor: vi.fn().mockImplementation(() => ({
			getInstance: vi.fn().mockReturnThis(),
			recordQuery: vi.fn(),
			recordError: vi.fn(),
			getMetrics: vi.fn().mockReturnValue({
				queryCount: 0,
				errorCount: 0,
				averageResponseTime: 0,
				errorRate: 0,
				slowQueries: [],
			}),
			resetMetrics: vi.fn(),
		})),
		dbConfig: {
			connectionString: "postgresql://test:test@localhost:5432/test",
			ssl: false,
			maxConnections: 20,
			idleTimeout: 30_000,
			connectionTimeout: 10_000,
		},
		initializeExtensions: vi.fn().mockResolvedValue(undefined),
	};
});

// Mock drizzle-orm
vi.mock("drizzle-orm/neon-serverless", () => ({
	drizzle: vi.fn(() => createMockDb()),
}));

// Mock the migration runner module
vi.mock("../../../db/migrations/migration-runner", () => {
	class MockMigrationRunner {
		constructor(public migrationsPath: string) {}

		async loadMigrations() {
			return [];
		}

		async validateMigrations() {
			return { valid: true, errors: [], warnings: [] };
		}

		async executeMigrations() {
			return { success: true, executed: [], errors: [] };
		}

		async rollbackMigration() {
			return { success: true, rolledBack: "test", error: null };
		}

		generateChecksum(content: string) {
			return "mock-checksum";
		}
	}

	return {
		MigrationRunner: MockMigrationRunner,
		migrationRunner: new MockMigrationRunner("./db/migrations"),
	};
});

// Mock Inngest client with comprehensive functionality
vi.mock("inngest", () => {
	const createMockInngest = (config?: any) => {
		const mockFn = vi.fn().mockImplementation((config, handler) => ({
			id: config?.id || "test-function",
			name: config?.name || "Test Function",
			handler,
		}));

		const mockInngest = {
			createFunction: mockFn,
			send: vi.fn().mockResolvedValue({ ids: ["test-id"] }),
			on: vi.fn().mockReturnValue(mockFn),
		};

		return mockInngest;
	};

	return {
		Inngest: vi.fn().mockImplementation(createMockInngest),
		InngestCommHandler: vi.fn().mockImplementation(() => ({
			register: vi.fn(),
			createHandler: vi.fn().mockReturnValue(async () => new Response("OK")),
		})),
		NonRetriableError: vi.fn().mockImplementation((message) => {
			const error = new Error(message);
			error.name = "NonRetriableError";
			return error;
		}),
	};
});

// Mock the lib/inngest module specifically
vi.mock("../../lib/inngest", () => ({
	inngest: {
		createFunction: vi.fn(),
		send: vi.fn().mockResolvedValue({ ids: ["test-id"] }),
		on: vi.fn(),
	},
	inngestConfig: {
		id: "test-app",
		name: "Test Application",
		env: "test",
	},
}));

// Mock src/shared/schemas/validation module first
vi.mock("../../src/shared/schemas/validation", () => {
	const mockEnv = {
		NODE_ENV: "test" as const,
		DATABASE_URL: "postgresql://test:test@localhost:5432/test",
		NEXT_PUBLIC_API_URL: "http://localhost:3000",
		INNGEST_SIGNING_KEY: "test-key",
		INNGEST_EVENT_KEY: "test-event-key",
		OPENAI_API_KEY: "test-openai-key",
		AUTH_SECRET: "test-auth-secret",
		ELECTRIC_URL: "http://localhost:5133",
		ELECTRIC_AUTH_TOKEN: "test-token",
		LETTA_API_KEY: "test-letta-key",
	};

	return {
		validateEnv: vi.fn().mockReturnValue(mockEnv),
		validateDevelopmentEnv: vi.fn().mockReturnValue(mockEnv),
		validateProductionEnv: vi.fn().mockReturnValue(mockEnv),
		validateTestEnv: vi.fn().mockReturnValue(mockEnv),
		getEnvSummary: vi.fn().mockReturnValue({
			environment: "test",
			databaseConnected: true,
			services: { redis: false, inngest: true },
			security: "Basic security only",
		}),
		EnvSchema: {
			parse: vi.fn().mockReturnValue(mockEnv),
			safeParse: vi.fn().mockReturnValue({ success: true, data: mockEnv }),
		},
	};
});

// Mock lib/env module
vi.mock("../../lib/env", () => ({
	env: {
		NODE_ENV: "test",
		DATABASE_URL: "postgresql://test:test@localhost:5432/test",
		NEXT_PUBLIC_API_URL: "http://localhost:3000",
		INNGEST_SIGNING_KEY: "test-key",
		INNGEST_EVENT_KEY: "test-event-key",
		OPENAI_API_KEY: "test-openai-key",
		AUTH_SECRET: "test-auth-secret",
		ELECTRIC_URL: "http://localhost:5133",
		ELECTRIC_AUTH_TOKEN: "test-token",
		LETTA_API_KEY: "test-letta-key",
	},
	apiKeys: {
		letta: { apiKey: "test-letta-key", baseUrl: "", projectId: "" },
		openai: { apiKey: "test-openai-key", publicKey: "" },
		google: { apiKey: "" },
		anthropic: { apiKey: "" },
	},
	database: {
		url: "postgresql://test:test@localhost:5432/test",
		electric: { url: "http://localhost:5133", authToken: "test-token" },
		redis: { url: "", host: "", port: 6379 },
	},
	auth: {
		secret: "test-auth-secret",
		nextAuthSecret: "",
		jwt: { secret: "", expiresIn: "1h" },
	},
	isProduction: vi.fn().mockReturnValue(false),
	isDevelopment: vi.fn().mockReturnValue(false),
	isTest: vi.fn().mockReturnValue(true),
}));

// Mock Electric client
vi.mock("../../lib/electric", () => ({
	electric: {
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		isConnected: vi.fn().mockReturnValue(true),
		sync: vi.fn().mockResolvedValue(undefined),
		db: createMockDb(),
	},
	ElectricProvider: vi.fn(({ children }) => children),
	useElectric: vi.fn(() => ({
		isConnected: true,
		connect: vi.fn(),
		disconnect: vi.fn(),
		sync: vi.fn(),
	})),
}));

// Mock Redis-related services that might not be fully implemented
vi.mock("../../lib/redis/metrics-service", () => ({
	MetricsService: vi.fn().mockImplementation(() => ({
		getInstance: vi.fn().mockReturnThis(),
		incrementCounter: vi.fn().mockResolvedValue(undefined),
		getCounter: vi.fn().mockResolvedValue(0),
		cleanup: vi.fn().mockResolvedValue(undefined),
	})),
}));

// Mock Redis client manager with enhanced Redis client methods
vi.mock("../../lib/redis/redis-client", () => ({
	RedisClientManager: {
		getInstance: vi.fn().mockReturnValue({
			initialize: vi.fn().mockResolvedValue(undefined),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getClient: vi.fn().mockReturnValue({
				connect: vi.fn().mockResolvedValue(undefined),
				disconnect: vi.fn().mockResolvedValue(undefined),
				get: vi.fn().mockResolvedValue(null),
				set: vi.fn().mockResolvedValue("OK"),
				del: vi.fn().mockResolvedValue(1),
				exists: vi.fn().mockResolvedValue(0),
				expire: vi.fn().mockResolvedValue(1),
				ttl: vi.fn().mockResolvedValue(-1),
				ping: vi.fn().mockResolvedValue("PONG"),
				on: vi.fn(),
				off: vi.fn(),
				hset: vi.fn().mockResolvedValue(1),
				hget: vi.fn().mockResolvedValue(null),
				hdel: vi.fn().mockResolvedValue(1),
				hgetall: vi.fn().mockResolvedValue({}),
				publish: vi.fn().mockResolvedValue(0),
				subscribe: vi.fn(),
				unsubscribe: vi.fn(),
				// Additional Redis client methods for comprehensive coverage
				lpush: vi.fn().mockResolvedValue(1),
				lpop: vi.fn().mockResolvedValue(null),
				rpush: vi.fn().mockResolvedValue(1),
				rpop: vi.fn().mockResolvedValue(null),
				llen: vi.fn().mockResolvedValue(0),
				lrange: vi.fn().mockResolvedValue([]),
				zadd: vi.fn().mockResolvedValue(1),
				zrange: vi.fn().mockResolvedValue([]),
				zrem: vi.fn().mockResolvedValue(1),
				zcard: vi.fn().mockResolvedValue(0),
				sadd: vi.fn().mockResolvedValue(1),
				srem: vi.fn().mockResolvedValue(1),
				smembers: vi.fn().mockResolvedValue([]),
				scard: vi.fn().mockResolvedValue(0),
				incr: vi.fn().mockResolvedValue(1),
				decr: vi.fn().mockResolvedValue(0),
				incrby: vi.fn().mockResolvedValue(1),
				decrby: vi.fn().mockResolvedValue(0),
				keys: vi.fn().mockResolvedValue([]),
				scan: vi.fn().mockResolvedValue(["0", []]),
			}),
			isConnected: vi.fn().mockReturnValue(true),
			getConnectionStatus: vi.fn().mockReturnValue("connected"),
		}),
	},
}));

// Mock Letta client
vi.mock("../../lib/letta/client", () => ({
	LettaClient: vi.fn().mockImplementation(() => ({
		createAgent: vi.fn().mockResolvedValue({ id: "test-agent" }),
		getAgent: vi.fn().mockResolvedValue({ id: "test-agent" }),
		sendMessage: vi.fn().mockResolvedValue({ response: "test response" }),
	})),
	createLettaClient: vi.fn().mockImplementation(() => ({
		createAgent: vi.fn().mockResolvedValue({ id: "test-agent" }),
	})),
}));

// Mock observability service and related modules
vi.mock("../../lib/observability", () => ({
	observability: {
		trackAgentExecution: vi.fn().mockImplementation(async (agentType, operation, fn) => {
			return await fn();
		}),
		recordEvent: vi.fn(),
		recordError: vi.fn(),
		getTracer: vi.fn().mockReturnValue({
			startSpan: vi.fn().mockReturnValue({
				setAttributes: vi.fn(),
				setStatus: vi.fn(),
				recordException: vi.fn(),
				end: vi.fn(),
			}),
		}),
	},
	ObservabilityService: vi.fn().mockImplementation(() => ({
		getInstance: vi.fn().mockReturnThis(),
		recordEvent: vi.fn(),
		recordMetric: vi.fn(),
		trackAgentExecution: vi.fn().mockImplementation(async (agentType, operation, fn) => {
			return await fn();
		}),
	})),
}));

// Mock workflow engine and related types
vi.mock("../../lib/workflow/engine", () => ({
	WorkflowExecutionEngine: vi.fn().mockImplementation(() => ({
		getInstance: vi.fn().mockReturnThis(),
		startWorkflow: vi.fn().mockResolvedValue({ id: "test-workflow" }),
		pauseExecution: vi.fn().mockResolvedValue(undefined),
		resumeExecution: vi.fn().mockResolvedValue(undefined),
		cancelExecution: vi.fn().mockResolvedValue(undefined),
		getExecution: vi.fn().mockResolvedValue(null),
	})),
	workflowEngine: {
		getInstance: vi.fn().mockReturnThis(),
		startWorkflow: vi.fn().mockResolvedValue({ id: "test-workflow" }),
		pauseExecution: vi.fn().mockResolvedValue(undefined),
		resumeExecution: vi.fn().mockResolvedValue(undefined),
		cancelExecution: vi.fn().mockResolvedValue(undefined),
		getExecution: vi.fn().mockResolvedValue(null),
	},
}));

// Mock workflow executors
vi.mock("../../lib/workflow/executors", () => ({
	stepExecutorRegistry: {
		register: vi.fn(),
		get: vi.fn().mockReturnValue({
			execute: vi.fn().mockResolvedValue({ status: "completed", output: {} }),
		}),
		registerWithStepExecution: vi.fn(),
	},
	ActionStepExecutor: vi.fn(),
	ConditionStepExecutor: vi.fn(),
	WaitStepExecutor: vi.fn(),
}));

// Mock workflow state machine
vi.mock("../../lib/workflow/state-machine", () => ({
	createWorkflowStateMachine: vi.fn().mockReturnValue({
		initialize: vi.fn(),
		transition: vi.fn().mockResolvedValue(undefined),
	}),
	StateValidation: {
		isTerminal: vi.fn().mockReturnValue(false),
	},
}));

// Mock workflow templates
vi.mock("../../lib/workflow/templates", () => ({
	templateRegistry: {
		createFromTemplate: vi.fn().mockReturnValue({
			name: "Test Workflow",
			version: "1.0.0",
			description: "Test workflow",
			steps: [],
			startStepId: "step-1",
			variables: {},
		}),
	},
	suggestTemplates: vi.fn().mockReturnValue([]),
	TEMPLATE_CATEGORIES: {},
}));

// Mock ulid for unique IDs
vi.mock("ulid", () => ({
	ulid: vi.fn(() => `test-ulid-${Date.now()}`),
}));

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Store original environment
const originalEnv = { ...process.env };

// Integration test specific cleanup
afterEach(() => {
	// Cleanup React components
	cleanup();

	// Restore environment variables
	process.env = { ...originalEnv };

	// Clear mocks but preserve some for integration testing
	vi.clearAllTimers();
	vi.clearAllMocks();

	// Reset DOM state (only if document exists)
	if (typeof document !== "undefined") {
		document.body.innerHTML = "";
		document.head.innerHTML = "";
	}
});

// Integration test specific setup
beforeEach(() => {
	// Set test environment
	vi.stubEnv("NODE_ENV", "test");
	vi.stubEnv("VITEST_POOL_ID", "1");

	// Set up test database URL if needed
	vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

	// Set up test API URLs
	vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3000");
	vi.stubEnv("INNGEST_SIGNING_KEY", "test-key");
	vi.stubEnv("INNGEST_EVENT_KEY", "test-event-key");
});

// Mock Next.js navigation with more realistic behavior
vi.mock("next/navigation", () => ({
	useRouter: () => ({
		push: vi.fn().mockImplementation((url) => {
			console.log("Router push:", url);
			return Promise.resolve();
		}),
		back: vi.fn(),
		forward: vi.fn(),
		refresh: vi.fn(),
		replace: vi.fn(),
		pathname: "/",
		query: {},
		asPath: "/",
	}),
	usePathname: () => "/",
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: vi.fn(),
	redirect: vi.fn(),
}));

// Mock Next.js Image with better implementation
vi.mock("next/image", () => ({
	default: vi.fn(({ src, alt, width, height, ...props }) => {
		// Return a mock element representation instead of JSX
		return {
			type: "img",
			props: {
				...props,
				src,
				alt,
				width,
				height,
				style: {
					width: typeof width === "number" ? `${width}px` : width,
					height: typeof height === "number" ? `${height}px` : height,
				},
			},
		};
	}),
}));

// Mock browser APIs with more realistic implementations
global.IntersectionObserver = vi.fn().mockImplementation((callback) => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn(),
	root: null,
	rootMargin: "0px",
	thresholds: [],
	takeRecords: vi.fn().mockReturnValue([]),
}));

global.ResizeObserver = vi.fn().mockImplementation((callback) => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn(),
}));

// Mock matchMedia for Node.js environment (only if window exists)
if (typeof window !== "undefined") {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn().mockImplementation((query) => ({
			matches: query.includes("max-width: 768px") ? false : true,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
}

// Mock localStorage with persistence
const localStorageData: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => localStorageData[key] || null),
	setItem: vi.fn((key: string, value: string) => {
		localStorageData[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete localStorageData[key];
	}),
	clear: vi.fn(() => {
		Object.keys(localStorageData).forEach((key) => delete localStorageData[key]);
	}),
	length: 0,
	key: vi.fn(),
};
if (typeof window !== "undefined") {
	Object.defineProperty(window, "localStorage", {
		value: localStorageMock,
	});
}

// Mock sessionStorage with persistence
const sessionStorageData: Record<string, string> = {};
const sessionStorageMock = {
	getItem: vi.fn((key: string) => sessionStorageData[key] || null),
	setItem: vi.fn((key: string, value: string) => {
		sessionStorageData[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete sessionStorageData[key];
	}),
	clear: vi.fn(() => {
		Object.keys(sessionStorageData).forEach((key) => delete sessionStorageData[key]);
	}),
	length: 0,
	key: vi.fn(),
};
if (typeof window !== "undefined") {
	Object.defineProperty(window, "sessionStorage", {
		value: sessionStorageMock,
	});
}

// Mock fetch with more realistic behavior
global.fetch = vi.fn().mockImplementation(async (url, options) => {
	const response = {
		ok: true,
		status: 200,
		json: async () => ({ success: true }),
		text: async () => "OK",
		headers: new Headers(),
		url: url as string,
	};

	// Handle different API endpoints
	if (url.toString().includes("/api/auth/")) {
		return Promise.resolve({
			...response,
			json: async () => ({ authenticated: true, user: { id: "test-user" } }),
		});
	}

	if (url.toString().includes("/api/tasks/")) {
		return Promise.resolve({
			...response,
			json: async () => ({ id: "test-task", status: "pending" }),
		});
	}

	return Promise.resolve(response);
});

// Mock crypto with better implementations
Object.defineProperty(global, "crypto", {
	value: {
		randomUUID: vi.fn(() => `test-uuid-${Date.now()}`),
		getRandomValues: vi.fn((arr) => {
			for (let i = 0; i < arr.length; i++) {
				arr[i] = Math.floor(Math.random() * 256);
			}
			return arr;
		}),
		subtle: {
			digest: vi.fn(),
			importKey: vi.fn(),
			exportKey: vi.fn(),
			generateKey: vi.fn(),
			deriveKey: vi.fn(),
			deriveBits: vi.fn(),
			encrypt: vi.fn(),
			decrypt: vi.fn(),
			sign: vi.fn(),
			verify: vi.fn(),
		},
	},
});

// Mock WebSocket with event simulation
global.WebSocket = vi.fn().mockImplementation((url) => {
	const ws = {
		url,
		readyState: 1,
		CONNECTING: 0,
		OPEN: 1,
		CLOSING: 2,
		CLOSED: 3,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		send: vi.fn(),
		close: vi.fn(),
		onopen: null,
		onmessage: null,
		onerror: null,
		onclose: null,
	};

	// Simulate connection
	setTimeout(() => {
		if (ws.onopen) ws.onopen(new Event("open"));
	}, 100);

	return ws;
});

// Mock performance with realistic timing
Object.defineProperty(global, "performance", {
	value: {
		now: vi.fn(() => Date.now()),
		mark: vi.fn(),
		measure: vi.fn(),
		getEntriesByType: vi.fn(() => []),
		getEntriesByName: vi.fn(() => []),
		clearMarks: vi.fn(),
		clearMeasures: vi.fn(),
	},
});

// Mock console with selective filtering
const originalError = console.error;
const originalWarn = console.warn;

beforeEach(() => {
	console.error = vi.fn((message) => {
		// Only suppress expected test errors
		if (
			typeof message === "string" &&
			(message.includes("Warning:") || message.includes("Error:"))
		) {
			return;
		}
		originalError(message);
	});

	console.warn = vi.fn((message) => {
		// Only suppress expected test warnings
		if (typeof message === "string" && message.includes("Warning:")) {
			return;
		}
		originalWarn(message);
	});
});

afterEach(() => {
	console.error = originalError;
	console.warn = originalWarn;
});
