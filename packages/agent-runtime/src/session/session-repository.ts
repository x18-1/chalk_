import {
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
  ownerId?: string;
};

export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} was not found`);
    this.name = "SessionNotFoundError";
  }
}

export type CreateSessionOptions = {
  ownerId?: string;
};

export interface RuntimeSession {
  readonly descriptor: SessionDescriptor;
  getMessages(): Promise<AgentMessage[]>;
  appendMessage(message: AgentMessage): Promise<void>;
  appendEvent(type: string, data?: unknown): Promise<void>;
  setName(name: string): Promise<void>;
}

export interface SessionRepository {
  create(options?: CreateSessionOptions): Promise<RuntimeSession>;
  open(sessionId: string): Promise<RuntimeSession>;
  delete(sessionId: string): Promise<void>;
}

export type JsonlSessionRepositoryOptions = {
  sessionsRoot: string;
  cwd: string;
};

function toDescriptor(metadata: JsonlSessionMetadata): SessionDescriptor {
  const ownerId = metadata.metadata?.ownerId;

  return {
    id: metadata.id,
    path: metadata.path,
    createdAt: metadata.createdAt,
    modifiedAt: metadata.modifiedAt,
    ...(typeof ownerId === "string" ? { ownerId } : {}),
  };
}

function wrapSession(
  session: Session<JsonlSessionMetadata>,
  metadata: JsonlSessionMetadata,
): RuntimeSession {
  return {
    descriptor: toDescriptor(metadata),

    async getMessages() {
      const entries = await session.findEntries({
        type: "message",
        order: "oldestFirst",
      });

      return entries.flatMap((entry) =>
        entry.type === "message" ? [entry.message] : [],
      );
    },

    async appendMessage(message) {
      const durableMessage = JSON.parse(JSON.stringify(message)) as AgentMessage;
      await session.appendMessage(durableMessage);
    },

    async appendEvent(type, data) {
      await session.appendCustomEntry(type, data);
    },

    async setName(name) {
      await session.setName(name);
    },
  };
}

export function createJsonlSessionRepository(
  options: JsonlSessionRepositoryOptions,
): SessionRepository {
  const env = new NodeExecutionEnv({ cwd: options.cwd });
  const repository = new JsonlSessionRepo({
    fs: env,
    sessionsRoot: options.sessionsRoot,
  });

  async function findMetadata(sessionId: string) {
    const sessions = await repository.list({ cwd: options.cwd });
    const metadata = sessions.find((session) => session.id === sessionId);

    if (!metadata) {
      throw new SessionNotFoundError(sessionId);
    }

    return metadata;
  }

  return {
    async create(createOptions = {}) {
      const session = await repository.create({
        cwd: options.cwd,
        ...(createOptions.ownerId
          ? { metadata: { ownerId: createOptions.ownerId } }
          : {}),
      });
      const metadata = await session.getMetadata();

      return wrapSession(session, metadata);
    },

    async open(sessionId) {
      const metadata = await findMetadata(sessionId);
      const session = await repository.open(metadata);
      return wrapSession(session, metadata);
    },

    async delete(sessionId) {
      const metadata = await findMetadata(sessionId);
      await repository.delete(metadata);
    },
  };
}
