import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model, Models } from "@earendil-works/pi-ai";

import type { GeometryArtifact } from "./tools";
import {
  createGeometryStage2Tools,
  createProblemFactsTool,
  createRunWorkspace,
} from "./tools";
import { loadGeometryPrompt } from "./prompts";
import type { ProblemFacts } from "./geometry";

export type SolveGeometryProblemInput = {
  problem: string;
  images?: ImageContent[];
  modelClient: { models: Models; model: Model<string> };
  sessionId?: string;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  onStage1?: (facts: ProblemFacts) => void | Promise<void>;
  onScene?: (scene: GeometryArtifact["scene"]) => void | Promise<void>;
  onGeoGebra?: (script: NonNullable<GeometryArtifact["geoGebra"]>) => void | Promise<void>;
  verifyGeoGebra?: (script: NonNullable<GeometryArtifact["geoGebra"]>) => Promise<string[]> | string[];
  onTimeline?: (timeline: GeometryArtifact["lessonTimeline"]) => void | Promise<void>;
};

export type SolveGeometryProblemResult = {
  artifact: GeometryArtifact;
  messages: AgentMessage[];
  stage1: ProblemFacts;
};

export async function solveGeometryProblem(
  input: SolveGeometryProblemInput,
): Promise<SolveGeometryProblemResult> {
  if (!input.problem.trim() && (!input.images || input.images.length === 0)) {
    throw new Error("A problem statement or at least one image is required");
  }

  const workspace = createRunWorkspace({ onStage1: input.onStage1, onScene: input.onScene, onGeoGebra: input.onGeoGebra, verifyGeoGebra: input.verifyGeoGebra, onTimeline: input.onTimeline });
  const extractionAgent = new Agent({
    streamFn: input.modelClient.models.streamSimple.bind(input.modelClient.models),
    sessionId: input.sessionId,
    toolExecution: "sequential",
    initialState: {
      systemPrompt: loadGeometryPrompt("stage1.system"),
      model: input.modelClient.model,
      thinkingLevel: "high",
      tools: [createProblemFactsTool(workspace)],
      messages: [],
    },
  });

  if (input.onEvent) extractionAgent.subscribe(input.onEvent);
  await extractionAgent.prompt(input.problem.trim() || "请仅根据图片识别并提取这道数学题。", input.images);

  if (extractionAgent.state.errorMessage) {
    throw new Error(`Geometry Agent stage 1 failed: ${extractionAgent.state.errorMessage}`);
  }
  if (!workspace.problemFacts) {
    throw new Error("Geometry Agent stage 1 stopped before submitting problem facts");
  }

  const stage1 = workspace.problemFacts;
  const stage2Prompt = [
    `题目：\n${input.problem.trim() || "（题目内容见配图）"}`,
    input.images && input.images.length > 0
      ? "\n参考图像已随本条消息附上：请逐一检查图中的坐标系、曲线、动点轨迹、直角标记和点标签，并与 Stage-1 提取交叉核对。图像是 Stage-2 的必要视觉输入，不得只依据 DSL 猜测图形。"
      : "\n本题没有附图，请仅依据题目文字和 Stage-1 提取构造场景。",
    "",
    "Stage-1 结构化提取（权威输入）：",
    JSON.stringify(stage1, null, 2),
  ].join("\n");
  const constructionAgent = new Agent({
    streamFn: input.modelClient.models.streamSimple.bind(input.modelClient.models),
    sessionId: input.sessionId ? `${input.sessionId}:stage2` : undefined,
    toolExecution: "sequential",
    initialState: {
      systemPrompt: loadGeometryPrompt("stage2.geogebra.system"),
      model: input.modelClient.model,
      thinkingLevel: "high",
      tools: createGeometryStage2Tools(workspace),
      messages: [],
    },
  });

  if (input.onEvent) constructionAgent.subscribe(input.onEvent);
  await constructionAgent.prompt(stage2Prompt, input.images);

  if (constructionAgent.state.errorMessage) {
    throw new Error(`Geometry Agent stage 2 failed: ${constructionAgent.state.errorMessage}`);
  }
  if (!workspace.artifact) {
    throw new Error("Geometry Agent stage 2 stopped before finalizing an artifact");
  }


  return {
    artifact: workspace.artifact,
    messages: [...extractionAgent.state.messages, ...constructionAgent.state.messages],
    stage1,
  };
}
