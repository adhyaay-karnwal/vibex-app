import { createHash } from "crypto";
import { desc, eq, sql as sqlOperator } from "drizzle-orm";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { db, sql } from "../config";
import { migrations, NewMigration } from "../schema";

export const MigrationFile = {
	name: "",
	up: "",
	down: "",
	checksum: "",
	metadata: {
		description: "",
		author: "",
		tags: [],
		dependencies: [],
	},
};

export const MigrationValidationResult = {
	valid: false,
	errors: [],
	warnings: [],
};

export const MigrationExecutionResult = {
	success: false,
	executed: [],
	errors: [],
	warnings: [],
	executionTime: 0,
};

export class MigrationRunner {
	constructor(migrationsPath = join(process.cwd(), "db/migrations/sql")) {
		this.migrationsPath = migrationsPath;
	}

	/**
	 * Generate checksum for migration content
	 */
	generateChecksum(content) {
		return createHash("sha256").update(content).digest("hex");
	}

	/**
	 * Load migration files from filesystem
	 */
	loadMigrationFiles(dir) {
		const files = readdirSync(dir).filter((file) => file.endsWith(".sql"));
		const migrationRegex = /^\d{3}_[a-z0-9_-]+\.sql$/i;

		return files
			.filter((file) => migrationRegex.test(file))
			.sort()
			.map((file) => {
				const filePath = join(dir, file);
				const content = readFileSync(filePath, "utf-8");
				const lines = content.split("\n");

				// Try to find Up/Down sections
				const upStartIndex = lines.findIndex((line) => line.trim() === "-- Up");
				const downStartIndex = lines.findIndex((line) => line.trim() === "-- Down");

				let upSql;
				let downSql;

				if (upStartIndex !== -1 && downStartIndex !== -1) {
					// File has proper Up/Down sections
					upSql = lines
						.slice(upStartIndex + 1, downStartIndex)
						.join("\n")
						.trim();

					downSql = lines
						.slice(downStartIndex + 1)
						.join("\n")
						.trim();
				} else {
					// Legacy format - treat entire file as Up, generate simple Down
					upSql = content.trim();

					// Extract table names for Down section
					const tableMatches = content.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi);
					const tables = tableMatches
						? tableMatches
								.map((match) => {
									const tableMatch = match.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
									return tableMatch ? tableMatch[1] : null;
								})
								.filter(Boolean)
						: [];

					// Generate Down SQL
					downSql = tables
						.reverse()
						.map((table) => `DROP TABLE IF EXISTS ${table};`)
						.join("\n");
				}

				const checksum = this.generateChecksum(upSql);

				return {
					name: file.replace(".sql", ""),
					up: upSql,
					down: downSql,
					checksum,
				};
			});
	}

	/**
	 * Get executed migrations from database
	 */
	async getExecutedMigrations() {
		try {
			return await db
				.select({
					name: migrations.name,
					checksum: migrations.checksum,
					executedAt: migrations.executedAt,
				})
				.from(migrations)
				.orderBy(desc(migrations.executedAt));
		} catch (error) {
			// If migrations table doesn't exist, return empty array
			console.warn("Migrations table not found, assuming first run");
			return [];
		}
	}

	/**
	 * Validate migration integrity with comprehensive checks
	 */
	async validateMigrations() {
		const errors = [];
		const warnings = [];
		const migrationFiles = this.loadMigrationFiles();
		const executedMigrations = await this.getExecutedMigrations();

		// Check for checksum mismatches
		for (const executed of executedMigrations) {
			const file = migrationFiles.find((f) => f.name === executed.name);
			if (file && file.checksum !== executed.checksum) {
				errors.push(`Checksum mismatch for migration ${executed.name}`);
			}
		}

		// Check for missing migration files
		for (const executed of executedMigrations) {
			const file = migrationFiles.find((f) => f.name === executed.name);
			if (!file) {
				errors.push(`Migration file not found: ${executed.name}`);
			}
		}

		// Check for duplicate migration names
		const nameCount = new Map();
		migrationFiles.forEach((file) => {
			nameCount.set(file.name, (nameCount.get(file.name) || 0) + 1);
		});
		nameCount.forEach((count, name) => {
			if (count > 1) {
				errors.push(`Duplicate migration name: ${name}`);
			}
		});

		// Check for missing rollback SQL
		migrationFiles.forEach((file) => {
			if (!file.down.trim()) {
				warnings.push(`Migration ${file.name} has no rollback SQL`);
			}
		});

		// Check for potentially dangerous operations
		migrationFiles.forEach((file) => {
			const upSql = file.up.toLowerCase();
			if (upSql.includes("drop table") && !upSql.includes("if exists")) {
				warnings.push(`Migration ${file.name} contains DROP TABLE without IF EXISTS`);
			}
			if (upSql.includes("alter table") && upSql.includes("drop column")) {
				warnings.push(`Migration ${file.name} drops columns - ensure data backup`);
			}
		});

		// Validate SQL syntax (basic check)
		migrationFiles.forEach((file) => {
			try {
				this.validateSQLSyntax(file.up);
				this.validateSQLSyntax(file.down);
			} catch (error) {
				errors.push(`SQL syntax error in migration ${file.name}: ${error.message}`);
			}
		});

		return {
			valid: errors.length === 0,
			errors,
			warnings,
		};
	}

	/**
	 * Basic SQL syntax validation
	 */
	validateSQLSyntax(sql) {
		const statements = sql.split(";").filter((stmt) => stmt.trim());

		for (const statement of statements) {
			const trimmed = statement.trim().toLowerCase();

			// Check for balanced parentheses
			const openParens = (statement.match(/\(/g) || []).length;
			const closeParens = (statement.match(/\)/g) || []).length;
			if (openParens !== closeParens) {
				throw new Error("Unbalanced parentheses");
			}

			// Check for basic SQL structure
			if (trimmed && !this.isValidSQLStatement(trimmed)) {
				throw new Error(`Invalid SQL statement: ${statement.substring(0, 50)}...`);
			}
		}
	}

	/**
	 * Check if statement starts with valid SQL keywords
	 */
	isValidSQLStatement(statement) {
		const validKeywords = [
			"select",
			"insert",
			"update",
			"delete",
			"create",
			"alter",
			"drop",
			"grant",
			"revoke",
			"commit",
			"rollback",
			"begin",
			"end",
			"with",
			"explain",
			"analyze",
			"vacuum",
			"reindex",
			"comment",
			"set",
			"show",
			"describe",
			"truncate",
			"copy",
			"lock",
			"unlock",
			"do",
			"declare",
			"return",
			"if",
			"for",
			"while",
			"loop",
			"case",
			"when",
			"else",
			"elseif",
			"elsif",
			"perform",
			"raise",
			"notice",
			"warning",
			"exception",
			"language",
			"plpgsql",
			"sql",
			"function",
			"procedure",
			"trigger",
			"extension",
			"schema",
			"domain",
			"type",
			"sequence",
			"view",
			"materialized",
			"index",
			"unique",
			"primary",
			"foreign",
			"check",
			"constraint",
			"column",
			"table",
			"database",
			"tablespace",
			"role",
			"user",
			"group",
			"policy",
			"rule",
			"operator",
			"cast",
			"aggregate",
			"collation",
			"conversion",
			"statistics",
			"publication",
			"subscription",
		];

		const firstWord = statement.split(/\s+/)[0].toLowerCase();

		// Allow comments
		if (statement.startsWith("--") || statement.startsWith("/*")) {
			return true;
		}

		// Allow PostgreSQL $$ syntax for functions/procedures
		if (
			statement.includes("$$") ||
			statement.includes("$function$") ||
			statement.includes("$procedure$")
		) {
			return true;
		}

		// Allow plpgsql blocks that start with variable declarations or control structures
		if (statement.match(/^\s*(declare|begin|if|for|while|case|return|perform|raise)/i)) {
			return true;
		}

		return validKeywords.includes(firstWord);
	}

	/**
	 * Execute a single migration
	 */
	async executeMigration(migration) {
		const startTime = Date.now();

		try {
			// Since Neon serverless doesn't support traditional transactions in the same way,
			// we'll execute statements within a BEGIN/COMMIT block
			await sql`BEGIN`;

			try {
				// Split SQL by semicolon and execute each statement
				const statements = migration.up
					.split(";")
					.map((stmt) => stmt.trim())
					.filter((stmt) => stmt.length > 0);

				for (const statement of statements) {
					// Execute raw SQL statement using drizzle's sql operator
					await db.execute(sqlOperator.raw(statement));
				}

				// Record migration execution
				await db.insert(migrations).values({
					name: migration.name,
					checksum: migration.checksum,
					rollbackSql: migration.down,
					metadata: {
						executionTimeMs: Date.now() - startTime,
						statementsCount: statements.length,
					},
				});

				await sql`COMMIT`;
			} catch (error) {
				await sql`ROLLBACK`;
				throw error;
			}

			console.log(
				`✅ Migration ${migration.name} executed successfully (${Date.now() - startTime}ms)`
			);
		} catch (error) {
			console.error(`❌ Migration ${migration.name} failed:`, error);
			throw error;
		}
	}

	/**
	 * Run pending migrations with enhanced validation and rollback capabilities
	 */
	async migrate() {
		const startTime = Date.now();
		console.log("🚀 Starting database migration...");

		const validation = await this.validateMigrations();
		if (!validation.valid) {
			console.error("❌ Migration validation failed:");
			validation.errors.forEach((error) => console.error(`  - ${error}`));
			return {
				success: false,
				executed: [],
				errors: validation.errors,
				warnings: validation.warnings,
				executionTime: Date.now() - startTime,
			};
		}

		if (validation.warnings.length > 0) {
			console.warn("⚠️  Migration warnings:");
			validation.warnings.forEach((warning) => console.warn(`  - ${warning}`));
		}

		const migrationFiles = this.loadMigrationFiles();
		const executedMigrations = await this.getExecutedMigrations();
		const executedNames = new Set(executedMigrations.map((m) => m.name));

		const pendingMigrations = migrationFiles.filter((m) => !executedNames.has(m.name));

		if (pendingMigrations.length === 0) {
			console.log("✅ No pending migrations");
			return {
				success: true,
				executed: [],
				errors: [],
				warnings: validation.warnings,
				executionTime: Date.now() - startTime,
			};
		}

		console.log(`📋 Found ${pendingMigrations.length} pending migrations`);

		const executed = [];
		const errors = [];
		const executedMigrationsBackup = [];

		// Create backup point before starting migrations
		await this.createBackupPoint();

		for (const migration of pendingMigrations) {
			try {
				console.log(`🔄 Executing migration: ${migration.name}`);
				await this.executeMigration(migration);
				executed.push(migration.name);
				executedMigrationsBackup.push(migration.name);
				console.log(`✅ Migration ${migration.name} completed successfully`);
			} catch (error) {
				console.error(`❌ Migration ${migration.name} failed: ${error.message}`);
				errors.push(`${migration.name}: ${error.message}`);

				// Attempt to rollback executed migrations in this batch
				if (executedMigrationsBackup.length > 0) {
					console.log("🔄 Attempting to rollback executed migrations in this batch...");
					await this.rollbackBatch(executedMigrationsBackup.reverse());
				}
				break; // Stop on first error
			}
		}

		const success = errors.length === 0;
		const executionTime = Date.now() - startTime;

		if (success) {
			console.log(`✅ Migration completed successfully in ${executionTime}ms`);
			await this.cleanupBackupPoint();
		} else {
			console.error(`❌ Migration failed after ${executionTime}ms`);
		}

		return {
			success,
			executed,
			errors,
			warnings: validation.warnings,
			executionTime,
		};
	}

	/**
	 * Create a backup point before migrations
	 */
	async createBackupPoint() {
		try {
			// This would typically create a database snapshot or backup
			// For now, we'll just log the current state
			console.log("📸 Creating backup point...");

			const backupMetadata = {
				timestamp: new Date().toISOString(),
				executedMigrations: await this.getExecutedMigrations(),
			};

			const backupPath = join(this.migrationsPath, "..", "backup");
			if (!existsSync(backupPath)) {
				mkdirSync(backupPath, { recursive: true });
			}

			writeFileSync(
				join(backupPath, `backup-${Date.now()}.json`),
				JSON.stringify(backupMetadata, null, 2)
			);

			console.log("✅ Backup point created");
		} catch (error) {
			console.warn("⚠️  Failed to create backup point:", error.message);
		}
	}

	/**
	 * Clean up backup point after successful migration
	 */
	async cleanupBackupPoint() {
		try {
			// Clean up old backup files (keep last 5)
			const backupPath = join(this.migrationsPath, "..", "backup");
			if (existsSync(backupPath)) {
				const backupFiles = readdirSync(backupPath)
					.filter((file) => file.startsWith("backup-") && file.endsWith(".json"))
					.sort()
					.reverse();

				// Keep only the 5 most recent backups
				const filesToDelete = backupFiles.slice(5);
				filesToDelete.forEach((file) => {
					try {
						unlinkSync(join(backupPath, file));
					} catch (error) {
						console.warn(`Failed to delete backup file ${file}:`, error.message);
					}
				});
			}
		} catch (error) {
			console.warn("⚠️  Failed to cleanup backup point:", error.message);
		}
	}

	/**
	 * Rollback a batch of migrations
	 */
	async rollbackBatch(migrationNames) {
		for (const name of migrationNames) {
			try {
				console.log(`🔄 Rolling back migration: ${name}`);

				const migration = await db
					.select()
					.from(migrations)
					.where(eq(migrations.name, name))
					.limit(1);

				if (migration.length > 0 && migration[0].rollbackSql) {
					await sql`BEGIN`;

					try {
						const statements = migration[0].rollbackSql
							.split(";")
							.map((stmt) => stmt.trim())
							.filter((stmt) => stmt.length > 0);

						for (const statement of statements) {
							await sql(statement);
						}

						await db.delete(migrations).where(eq(migrations.id, migration[0].id));

						await sql`COMMIT`;
					} catch (error) {
						await sql`ROLLBACK`;
						throw error;
					}

					console.log(`✅ Rolled back migration: ${name}`);
				}
			} catch (error) {
				console.error(`❌ Failed to rollback migration ${name}:`, error.message);
			}
		}
	}

	/**
	 * Rollback last migration
	 */
	async rollback() {
		console.log("🔄 Starting migration rollback...");

		try {
			const lastMigration = await db
				.select()
				.from(migrations)
				.orderBy(desc(migrations.executedAt))
				.limit(1);

			if (lastMigration.length === 0) {
				return { success: false, error: "No migrations to rollback" };
			}

			const migration = lastMigration[0];

			if (!migration.rollbackSql) {
				return {
					success: false,
					error: `No rollback SQL found for migration ${migration.name}`,
				};
			}

			await sql`BEGIN`;

			try {
				// Execute rollback SQL
				const statements = migration.rollbackSql
					.split(";")
					.map((stmt) => stmt.trim())
					.filter((stmt) => stmt.length > 0);

				for (const statement of statements) {
					// Execute raw SQL statement using drizzle's sql operator
					await db.execute(sqlOperator.raw(statement));
				}

				// Remove migration record
				await db.delete(migrations).where(eq(migrations.id, migration.id));

				await sql`COMMIT`;
			} catch (error) {
				await sql`ROLLBACK`;
				throw error;
			}

			console.log(`✅ Migration ${migration.name} rolled back successfully`);
			return { success: true, rolledBack: migration.name };
		} catch (error) {
			console.error("❌ Rollback failed:", error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Get migration status
	 */
	async getStatus() {
		const migrationFiles = this.loadMigrationFiles();
		const executedMigrations = await this.getExecutedMigrations();
		const executedNames = new Set(executedMigrations.map((m) => m.name));

		const pending = migrationFiles.filter((m) => !executedNames.has(m.name)).map((m) => m.name);

		return {
			executed: executedMigrations.map((m) => ({
				name: m.name,
				executedAt: m.executedAt,
			})),
			pending,
			total: migrationFiles.length,
		};
	}

	/**
	 * Create a new migration file with enhanced template
	 */
	async createMigration(name, options) {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
		const filename = `${timestamp}_${name}.sql`;
		const filepath = join(this.migrationsPath, filename);

		const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}
${options?.description ? `-- Description: ${options.description}` : ""}
${options?.author ? `-- Author: ${options.author}` : ""}
${options?.tags ? `-- Tags: ${options.tags.join(", ")}` : ""}

-- Up
-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   name varchar(255) NOT NULL,
--   created_at timestamp DEFAULT now() NOT NULL
-- );
-- CREATE INDEX example_name_idx ON example (name);


-- Down
-- Add your rollback SQL here
-- Example:
-- DROP TABLE IF EXISTS example;

`;

		writeFileSync(filepath, template);
		console.log(`✅ Created migration file: ${filename}`);
		return filepath;
	}

	/**
	 * Validate database schema integrity
	 */
	async validateSchema() {
		const issues = [];
		const recommendations = [];

		try {
			// Check for missing indexes on foreign keys
			const foreignKeyQuery = `
        SELECT 
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
      `;

			const foreignKeys = await sql(foreignKeyQuery);

			for (const fk of foreignKeys) {
				const indexQuery = `
          SELECT indexname 
          FROM pg_indexes 
          WHERE tablename = '${fk.table_name}' 
          AND indexdef LIKE '%${fk.column_name}%'
        `;

				const indexes = await sql(indexQuery);
				if (indexes.length === 0) {
					recommendations.push(
						`Consider adding index on ${fk.table_name}.${fk.column_name} (foreign key)`
					);
				}
			}

			// Check for tables without primary keys
			const tablesQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN (
          SELECT table_name 
          FROM information_schema.table_constraints 
          WHERE constraint_type = 'PRIMARY KEY'
        )
      `;

			const tablesWithoutPK = await sql(tablesQuery);
			tablesWithoutPK.forEach((row) => {
				issues.push(`Table ${row.table_name} has no primary key`);
			});

			// Check for unused indexes (this would require pg_stat_user_indexes)
			try {
				const unusedIndexQuery = `
          SELECT 
            schemaname,
            tablename,
            indexname,
            idx_tup_read,
            idx_tup_fetch
          FROM pg_stat_user_indexes
          WHERE idx_tup_read = 0 AND idx_tup_fetch = 0
        `;

				const unusedIndexes = await sql(unusedIndexQuery);
				unusedIndexes.forEach((row) => {
					recommendations.push(`Index ${row.indexname} on ${row.tablename} appears unused`);
				});
			} catch (error) {
				// pg_stat_user_indexes might not be available
				console.warn("Could not check for unused indexes:", error.message);
			}
		} catch (error) {
			issues.push(`Schema validation error: ${error.message}`);
		}

		return {
			valid: issues.length === 0,
			issues,
			recommendations,
		};
	}

	/**
	 * Get database statistics and health metrics
	 */
	async getDatabaseStats() {
		try {
			// Get table statistics
			const tableStatsQuery = `
        SELECT 
          schemaname,
          tablename,
          n_tup_ins + n_tup_upd + n_tup_del as total_operations,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_tuples,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_stat_user_tables
        ORDER BY total_operations DESC
      `;

			const tableStats = await sql(tableStatsQuery);

			// Get index count per table
			const indexCountQuery = `
        SELECT 
          tablename,
          COUNT(*) as index_count
        FROM pg_indexes
        WHERE schemaname = 'public'
        GROUP BY tablename
      `;

			const indexCounts = await sql(indexCountQuery);
			const indexCountMap = new Map(indexCounts.map((row) => [row.tablename, row.index_count]));

			// Get total database size
			const dbSizeQuery = "SELECT pg_size_pretty(pg_database_size(current_database())) as size";
			const dbSize = await sql(dbSizeQuery);

			// Get connection count
			const connectionQuery = "SELECT count(*) as count FROM pg_stat_activity";
			const connections = await sql(connectionQuery);

			// Get installed extensions
			const extensionsQuery = "SELECT extname FROM pg_extension ORDER BY extname";
			const extensions = await sql(extensionsQuery);

			return {
				tables: tableStats.map((row) => ({
					name: row.tablename,
					rowCount: Number.parseInt(row.live_tuples) || 0,
					size: row.size || "0 bytes",
					indexes: indexCountMap.get(row.tablename) || 0,
				})),
				totalSize: dbSize[0]?.size || "0 bytes",
				connectionCount: Number.parseInt(connections[0]?.count) || 0,
				extensions: extensions.map((row) => row.extname),
			};
		} catch (error) {
			console.error("Failed to get database stats:", error);
			return {
				tables: [],
				totalSize: "0 bytes",
				connectionCount: 0,
				extensions: [],
			};
		}
	}

	/**
	 * Optimize database performance
	 */
	async optimizeDatabase() {
		const operations = [];
		const errors = [];

		try {
			// Update table statistics
			console.log("📊 Updating table statistics...");
			await sql`ANALYZE`;
			operations.push("Updated table statistics (ANALYZE)");

			// Vacuum tables to reclaim space
			console.log("🧹 Vacuuming tables...");
			const tablesQuery = `
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
      `;
			const tables = await sql(tablesQuery);

			for (const table of tables) {
				try {
					await sql(`VACUUM ${table.tablename}`);
					operations.push(`Vacuumed table: ${table.tablename}`);
				} catch (error) {
					errors.push(`Failed to vacuum ${table.tablename}: ${error.message}`);
				}
			}

			// Reindex if needed (be careful with this in production)
			if (process.env.NODE_ENV !== "production") {
				console.log("🔄 Reindexing database...");
				try {
					await sql`REINDEX DATABASE CONCURRENTLY`;
					operations.push("Reindexed database");
				} catch (error) {
					// REINDEX DATABASE might not be supported, try individual tables
					for (const table of tables) {
						try {
							await sql(`REINDEX TABLE ${table.tablename}`);
							operations.push(`Reindexed table: ${table.tablename}`);
						} catch (tableError) {
							errors.push(`Failed to reindex ${table.tablename}: ${tableError.message}`);
						}
					}
				}
			}
		} catch (error) {
			errors.push(`Database optimization error: ${error.message}`);
		}

		return {
			success: errors.length === 0,
			operations,
			errors,
		};
	}
}

// Export singleton instance
export const migrationRunner = new MigrationRunner();
