import { readFile, stat } from "node:fs/promises";

import {
  buildSessionContext,
  JsonlSessionRepo,
  type AgentMessage,
  type JsonlSessionMetadata,
  type Session,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

export type SessionDescriptor = {
  id: string;
  path: string;
  createdAt: number;
  modifiedAt: number;
  ownerId: string;
};

export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} was not found`);
    this.name = "SessionNotFoundError";
  }
}

export type CreateSessionOptions = {
  ownerId: string;
};

export interface RuntimeSession {
  readonly descriptor: SessionDescriptor;
  getMessages(): Promise<AgentMessage[]>;
  getTranscript(): Promise<AgentMessage[]>;
  appendMessage(message: AgentMessage): Promise<void>;
  appendCompaction(input: {
    summary: string;
    retainedTail: AgentMessage[];
    tokensBefore: number;
  }): Promise<void>;
  appendEvent(type: string, data?: unknown): Promise<void>;
  setName(name: string): Promise<void>;
}

export interface SessionRepository {
  create(options: CreateSessionOptions): Promise<RuntimeSession>;
  open(ownerId: string, sessionId: string, sessionFilePath?: string): Promise<RuntimeSession>;
  delete(ownerId: string, sessionId: string, sessionFilePath?: string): Promise<void>;
}

export type JsonlSessionRepositoryOptions = {
  sessionsRoot: string;
  cwd: string;
};

function toDescriptor(metadata: JsonlSessionMetadata): SessionDescriptor {
  const ownerId = metadata.metadata?.ownerId;
  if (typeof ownerId !== "string") {
    throw new SessionNotFoundError(metadata.id);
  }

  return {
    id: metadata.id,
    path: metadata.path,
    createdAt: metadata.createdAt,
    modifiedAt: metadata.modifiedAt,
    ownerId,
  };
}

function wrapSession(
  session: Session<JsonlSessionMetadata>,
  metadata: JsonlSessionMetadata,
): RuntimeSession {
  return {
    descriptor: toDescriptor(metadata),

    async getMessages() {
      const entries = await session.findEntries({ order: "oldestFirst" });
      return buildSessionContext(entries).messages;
    },

    async getTranscript() {
      const entries = await session.findEntries({ order: "oldestFirst" });
      return entries.flatMap((entry) => entry.type === "message" ? [entry.message] : []);
    },

    async appendMessage(message) {
      const durableMessage = JSON.parse(JSON.stringify(message)) as AgentMessage;
      await session.appendMessage(durableMessage);
    },

    async appendCompaction(input) {
      await session.appendEntry({
        type: "compaction",
        id: session.idGenerator.next(),
        summary: input.summary,
        retainedTail: JSON.parse(JSON.stringify(input.retainedTail)) as AgentMessage[],
        tokensBefore: input.tokensBefore,
      }, "main");
    },

    async appendEvent(type, data) {
      await session.appendCustomEntry(type, data);
    },

    async setName(name) {
      await session.setName(name);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function metadataAtPath(
  ownerId: string,
  sessionId: string,
  sessionFilePath: string,
): Promise<JsonlSessionMetadata> {
  try {
    const [contents, fileStats] = await Promise.all([
      readFile(sessionFilePath, "utf8"),
      stat(sessionFilePath),
    ]);
    const firstLine = contents.split(/\r?\n/, 1)[0] ?? "";
    const header = JSON.parse(firstLine) as Record<string, unknown>;
    const metadata = isRecord(header.metadata)
      ? header.metadata as JsonlSessionMetadata["metadata"]
      : undefined;
    if (
      header.kind !== "header" ||
      (header.version !== 3 && header.version !== 4) ||
      header.id !== sessionId ||
      typeof header.createdAt !== "number" ||
      typeof header.cwd !== "string" ||
      metadata?.ownerId !== ownerId
    ) {
      throw new SessionNotFoundError(sessionId);
    }

    return {
      id: sessionId,
      createdAt: header.createdAt,
      cwd: header.cwd,
      path: sessionFilePath,
      modifiedAt: fileStats.mtimeMs,
      sourceFormat: header.version,
      ...(metadata ? { metadata } : {}),
    };
  } catch (error) {
    if (error instanceof SessionNotFoundError) throw error;
    throw new SessionNotFoundError(sessionId);
  }
}

export function createJsonlSessionRepository(
  options: JsonlSessionRepositoryOptions,
): SessionRepository {
  const env = new NodeExecutionEnv({ cwd: options.cwd });
  const repository = new JsonlSessionRepo({
    fs: env,
    sessionsRoot: options.sessionsRoot,
  });

  async function findMetadata(ownerId: string, sessionId: string) {
    const sessions = await repository.list({ cwd: options.cwd });
    const metadata = sessions.find(
      (session) =>
        session.id === sessionId && session.metadata?.ownerId === ownerId,
    );

    if (!metadata) {
      throw new SessionNotFoundError(sessionId);
    }

    return metadata;
  }

  return {
    async create(createOptions) {
      const session = await repository.create({
        cwd: options.cwd,
        metadata: { ownerId: createOptions.ownerId },
      });
      const metadata = await session.getMetadata();

      return wrapSession(session, metadata);
    },

    async open(ownerId, sessionId, sessionFilePath) {
      const metadata = sessionFilePath
        ? await metadataAtPath(ownerId, sessionId, sessionFilePath)
        : await findMetadata(ownerId, sessionId);
      const session = await repository.open(metadata);
      return wrapSession(session, metadata);
    },

    async delete(ownerId, sessionId, sessionFilePath) {
      const metadata = sessionFilePath
        ? await metadataAtPath(ownerId, sessionId, sessionFilePath)
        : await findMetadata(ownerId, sessionId);
      await repository.delete(metadata);
    },
  };
}
