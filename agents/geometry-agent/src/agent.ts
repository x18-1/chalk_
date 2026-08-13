import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model, Models } from "@earendil-works/pi-ai";

import type { GeometryArtifact } from "./tools";
import { createGeometryTools, createRunWorkspace } from "./tools";
import { GEOMETRY_AGENT_SYSTEM_PROMPT } from "./prompt";

export type SolveGeometryProblemInput = {
  problem: string;
  images?: ImageContent[];
  modelClient: { models: Models; model: Model<string> };
  sessionId?: string;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
};

export type SolveGeometryProblemResult = {
  artifact: GeometryArtifact;
  messages: AgentMessage[];
};

export async function solveGeometryProblem(
  input: SolveGeometryProblemInput,
): Promise<SolveGeometryProblemResult> {
  if (!input.problem.trim() && (!input.images || input.images.length === 0)) {
    throw new Error("A problem statement or at least one image is required");
  }

  const workspace = createRunWorkspace();
  const agent = new Agent({
    streamFn: input.modelClient.models.streamSimple.bind(input.modelClient.models),
    sessionId: input.sessionId,
    toolExecution: "sequential",
    initialState: {
      systemPrompt: GEOMETRY_AGENT_SYSTEM_PROMPT,
      model: input.modelClient.model,
      thinkingLevel: "high",
      tools: createGeometryTools(workspace),
      messages: [],
    },
  });

  if (input.onEvent) agent.subscribe(input.onEvent);
  await agent.prompt(input.problem.trim() || "请仅根据图片识别并构造这道几何题。", input.images);

  if (agent.state.errorMessage) {
    throw new Error(`Geometry Agent failed: ${agent.state.errorMessage}`);
  }
  if (!workspace.artifact) {
    throw new Error("Geometry Agent stopped before finalizing an artifact");
  }

  return { artifact: workspace.artifact, messages: [...agent.state.messages] };
}
