export const PROMPT_IDS = {
  CHAT_MAIN: 'chat-main',
  CHAT_SUBAGENT: 'chat-subagent',
  CONVERSATION_TITLE: 'conversation-title',
  CLASSROOM_OUTLINE: 'classroom-outline',
  CLASSROOM_AGENT_PROFILES: 'classroom-agent-profiles',
  CLASSROOM_SLIDE_CONTENT: 'classroom-slide-content',
  CLASSROOM_QUIZ_CONTENT: 'classroom-quiz-content',
  CLASSROOM_SIMULATION_CONTENT: 'classroom-simulation-content',
  CLASSROOM_DIAGRAM_CONTENT: 'classroom-diagram-content',
  CLASSROOM_CODE_CONTENT: 'classroom-code-content',
  CLASSROOM_GAME_CONTENT: 'classroom-game-content',
  CLASSROOM_VISUALIZATION3D_CONTENT: 'classroom-visualization3d-content',
  CLASSROOM_SLIDE_ACTIONS: 'classroom-slide-actions',
  CLASSROOM_QUIZ_ACTIONS: 'classroom-quiz-actions',
  CLASSROOM_INTERACTIVE_ACTIONS: 'classroom-interactive-actions',
  CLASSROOM_DISCUSSION_DIRECTOR: 'classroom-discussion-director',
  CLASSROOM_DISCUSSION_PARTICIPANT: 'classroom-discussion-participant',
} as const;

export type PromptId = typeof PROMPT_IDS[keyof typeof PROMPT_IDS];

export type PromptVariables = {
  [PROMPT_IDS.CHAT_MAIN]: {
    skillsPrompt: string;
  };
  [PROMPT_IDS.CHAT_SUBAGENT]: {
    focusLine: string;
    parentSessionId: string;
  };
  [PROMPT_IDS.CONVERSATION_TITLE]: Record<string, never>;
  [PROMPT_IDS.CLASSROOM_OUTLINE]: {
    requirement: string;
    pdfContent: string;
    availableImages: string;
    researchContext: string;
    teacherContext: string;
    userProfile: string;
    hasSourceImages: boolean;
    imageEnabled: boolean;
    videoEnabled: boolean;
    mediaEnabled: boolean;
  };
  [PROMPT_IDS.CLASSROOM_AGENT_PROFILES]: {
    courseTitle: string;
    courseDescription: string;
    sceneOutlines: string;
    languageDirective: string;
  };
  [PROMPT_IDS.CLASSROOM_SLIDE_CONTENT]: {
    title: string;
    description: string;
    keyPoints: string;
    teacherContext: string;
    assignedImages: string;
    canvas_width: number;
    canvas_height: number;
    languageDirective: string;
    mediaElementEnabled: boolean;
    imageElementEnabled: boolean;
    generatedImageEnabled: boolean;
    generatedVideoEnabled: boolean;
  };
  [PROMPT_IDS.CLASSROOM_QUIZ_CONTENT]: {
    title: string;
    description: string;
    keyPoints: string;
    questionCount: number;
    difficulty: string;
    questionTypes: string;
    languageDirective: string;
  };
  [PROMPT_IDS.CLASSROOM_SIMULATION_CONTENT]: {
    conceptName: string;
    conceptOverview: string;
    keyPoints: string;
    variables: string;
    designIdea: string;
    languageDirective: string;
  };
  [PROMPT_IDS.CLASSROOM_DIAGRAM_CONTENT]: {
    title: string;
    diagramType: string;
    description: string;
    keyPoints: string;
    nodeCount: number;
    prescribedNodes: unknown[];
    hasNodeCount: boolean;
    hasPrescribedNodes: boolean;
    languageDirective: string;
  };
  [PROMPT_IDS.CLASSROOM_CODE_CONTENT]: {
    title: string;
    programmingLanguage: string;
    description: string;
    keyPoints: string;
    starterCode: string;
    testCases: string;
    hints: string;
    languageDirective: string;
  };
  [PROMPT_IDS.CLASSROOM_GAME_CONTENT]: {
    title: string;
    gameType: string;
    description: string;
    keyPoints: string;
    scoring: Record<string, unknown>;
    languageDirective: string;
  };
  [PROMPT_IDS.CLASSROOM_VISUALIZATION3D_CONTENT]: {
    title: string;
    visualizationType: string;
    description: string;
    keyPoints: string;
    objects: unknown[];
    interactions: unknown[];
    languageDirective: string;
  };
  [PROMPT_IDS.CLASSROOM_SLIDE_ACTIONS]: {
    title: string;
    keyPoints: string;
    description: string;
    elements: string;
    courseContext: string;
    agents: string;
    userProfile: string;
    languageDirective: string;
  };
  [PROMPT_IDS.CLASSROOM_QUIZ_ACTIONS]: {
    questions: string;
    title: string;
    keyPoints: string;
    description: string;
    courseContext: string;
    agents: string;
    languageDirective: string;
  };
  [PROMPT_IDS.CLASSROOM_INTERACTIVE_ACTIONS]: {
    title: string;
    conceptName: string;
    description: string;
    designIdea: string;
    keyPoints: string;
    widgetType: string;
    widgetConfig: string;
    elementInventory: string;
    courseContext: string;
    agents: string;
    languageDirective: string;
  };
  [PROMPT_IDS.CLASSROOM_DISCUSSION_DIRECTOR]: {
    agentList: string;
    respondedList: string;
    conversationSummary: string;
    discussionSection: string;
    whiteboardSection: string;
    studentProfileSection: string;
    rule1: string;
    turnCountPlusOne: number;
    whiteboardOpenText: string;
  };
  [PROMPT_IDS.CLASSROOM_DISCUSSION_PARTICIPANT]: {
    agentName: string;
    persona: string;
    roleGuideline: string;
    peerContext: string;
    languageConstraint: string;
    stateContext: string;
    chalkboardState: string;
    chalkboardGuidelines: string;
    discussionContextSection: string;
    lengthGuidelines: string;
  };
};

type PromptDefinition<Id extends PromptId = PromptId> = {
  id: Id;
  variables: readonly (keyof PromptVariables[Id] & string)[];
  user: boolean;
  provenance?: {
    sourceRepository: string;
    sourceCommit: string;
    files: Readonly<Record<string, string>>;
  };
  adaptedFrom?: {
    sourceRepository: string;
    sourceCommit: string;
    sourceFile: string;
    sourceHash: string;
    reason: string;
  };
};

export const promptRegistry = {
  [PROMPT_IDS.CHAT_MAIN]: {
    id: PROMPT_IDS.CHAT_MAIN,
    variables: ['skillsPrompt'],
    user: false,
  },
  [PROMPT_IDS.CHAT_SUBAGENT]: {
    id: PROMPT_IDS.CHAT_SUBAGENT,
    variables: ['focusLine', 'parentSessionId'],
    user: false,
  },
  [PROMPT_IDS.CONVERSATION_TITLE]: {
    id: PROMPT_IDS.CONVERSATION_TITLE,
    variables: [],
    user: false,
  },
  [PROMPT_IDS.CLASSROOM_OUTLINE]: {
    id: PROMPT_IDS.CLASSROOM_OUTLINE,
    variables: [
      'requirement',
      'pdfContent',
      'availableImages',
      'researchContext',
      'teacherContext',
      'userProfile',
      'hasSourceImages',
      'imageEnabled',
      'videoEnabled',
      'mediaEnabled',
    ],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': '813240c132acfe63007ddcf3dd764b47b5ad1d7b5005d47361ede3aa42614c65',
        'user.en.md': '79fe5ce9a64dc63f174bd1c99dd3e4f1feb2a00e2797edc2a11abc5ac2d6f9ff',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_AGENT_PROFILES]: {
    id: PROMPT_IDS.CLASSROOM_AGENT_PROFILES,
    variables: ['courseTitle', 'courseDescription', 'sceneOutlines', 'languageDirective'],
    user: true,
    adaptedFrom: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      sourceFile: 'app/api/generate/agent-profiles/route.ts',
      sourceHash: '7739cd99c5794b86f4ff9c396313088958d3edab7163cd852dbddf4919c4aa89',
      reason: 'Chalk stores the instructional identity fields needed by its discussion runtime; provider-specific avatar, color, and voice assignment remain presentation concerns.',
    },
  },
  [PROMPT_IDS.CLASSROOM_SLIDE_CONTENT]: {
    id: PROMPT_IDS.CLASSROOM_SLIDE_CONTENT,
    variables: [
      'title',
      'description',
      'keyPoints',
      'teacherContext',
      'assignedImages',
      'canvas_width',
      'canvas_height',
      'languageDirective',
      'mediaElementEnabled',
      'imageElementEnabled',
      'generatedImageEnabled',
      'generatedVideoEnabled',
    ],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': 'fac82e884070e71cf82ffca67fb1ee1c861e3cd90d4f9816c7085c428180aebd',
        'user.en.md': '7d7486fed0d897a85273794359cd17383d7b9f2dbca7481134a1519687368c99',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_QUIZ_CONTENT]: {
    id: PROMPT_IDS.CLASSROOM_QUIZ_CONTENT,
    variables: [
      'title',
      'description',
      'keyPoints',
      'questionCount',
      'difficulty',
      'questionTypes',
      'languageDirective',
    ],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': '9f8b9d192f202e060ded6b0d9bc2164cc7baa00f079b1edbfcacb852513f96fd',
        'user.en.md': '823409f741caa49ba136711e4f5be79d505c060cf7432dc5dcde5973390c59e0',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_SIMULATION_CONTENT]: {
    id: PROMPT_IDS.CLASSROOM_SIMULATION_CONTENT,
    variables: [
      'conceptName',
      'conceptOverview',
      'keyPoints',
      'variables',
      'designIdea',
      'languageDirective',
    ],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': 'b1ec88316f06da25e76e44b8a103639158a75fb28e45c3be82d8c48eba67d66c',
        'user.en.md': 'c5d30132dc28938b54cc22d6ba168943b8eb5066a347f00e9c6d6e6bd0dfef2d',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_DIAGRAM_CONTENT]: {
    id: PROMPT_IDS.CLASSROOM_DIAGRAM_CONTENT,
    variables: [
      'title',
      'diagramType',
      'description',
      'keyPoints',
      'nodeCount',
      'prescribedNodes',
      'hasNodeCount',
      'hasPrescribedNodes',
      'languageDirective',
    ],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': 'fd03fa315fa4d5eca278dbc985d430090725cc88cd795e5d854bd7294cc3e6f1',
        'user.en.md': 'a475c7ed074cc80758384676d38891555f9d5213771c4459c9c3fff74894b656',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_CODE_CONTENT]: {
    id: PROMPT_IDS.CLASSROOM_CODE_CONTENT,
    variables: [
      'title',
      'programmingLanguage',
      'description',
      'keyPoints',
      'starterCode',
      'testCases',
      'hints',
      'languageDirective',
    ],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': '0d49ca8c8483e14aabf120ab95ccebc13db7f9a25167599324463a6df16c4459',
        'user.en.md': '5cd48712326d5e1e1e0335f623f1b8770d5b2915dbd2877ec41bfeec49f5d18e',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_GAME_CONTENT]: {
    id: PROMPT_IDS.CLASSROOM_GAME_CONTENT,
    variables: ['title', 'gameType', 'description', 'keyPoints', 'scoring', 'languageDirective'],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': '0224956d8e15921c39b5d27a1e1d5c58184093693425962ed6145b2b2c9836db',
        'user.en.md': '21ece6285e2dcea25f583b4995deef7e0f1aca9ee68aa8623349fdfe6c2ceea6',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_VISUALIZATION3D_CONTENT]: {
    id: PROMPT_IDS.CLASSROOM_VISUALIZATION3D_CONTENT,
    variables: [
      'title',
      'visualizationType',
      'description',
      'keyPoints',
      'objects',
      'interactions',
      'languageDirective',
    ],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': 'cd9ba73e9d081e991c73838a1afd85d665c01b13a5f11079abad3ea9569f0fc6',
        'user.en.md': '962b8fc01b310a8a7cf00165b0477708d81ab2b9c7388bc0f321eb40bcdd4dcc',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_SLIDE_ACTIONS]: {
    id: PROMPT_IDS.CLASSROOM_SLIDE_ACTIONS,
    variables: [
      'title',
      'keyPoints',
      'description',
      'elements',
      'courseContext',
      'agents',
      'userProfile',
      'languageDirective',
    ],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': '219e8da1eb3c854dbe6ee6fdedda1936e0092fff6c8984b9277c5c6cef2443b6',
        'user.en.md': '71a95329793ba0fae6030b6b9eb562bed62e9460bd26c2fcbd92d7c53f549512',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_QUIZ_ACTIONS]: {
    id: PROMPT_IDS.CLASSROOM_QUIZ_ACTIONS,
    variables: [
      'questions',
      'title',
      'keyPoints',
      'description',
      'courseContext',
      'agents',
      'languageDirective',
    ],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': '7ec6bfbe2fbc94af7b03e79462245cc7f8fd7f0aa8fb3d0100c903d890e52331',
        'user.en.md': '281146d66843b36b5d31fbaf9aaad24aa3ee0322778f9b6ddc9ff63a48b81666',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_INTERACTIVE_ACTIONS]: {
    id: PROMPT_IDS.CLASSROOM_INTERACTIVE_ACTIONS,
    variables: [
      'title',
      'conceptName',
      'description',
      'designIdea',
      'keyPoints',
      'widgetType',
      'widgetConfig',
      'elementInventory',
      'courseContext',
      'agents',
      'languageDirective',
    ],
    user: true,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': 'aac722a48c6bdd1f099f800e465d2fd2c7d214ea81f88704ec821c852b33eb7c',
        'user.en.md': '2007962e0454b51dc95be8ccbe40a87ceb711436f00bae8dbd88cba233b0ac27',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_DISCUSSION_DIRECTOR]: {
    id: PROMPT_IDS.CLASSROOM_DISCUSSION_DIRECTOR,
    variables: [
      'agentList',
      'respondedList',
      'conversationSummary',
      'discussionSection',
      'whiteboardSection',
      'studentProfileSection',
      'rule1',
      'turnCountPlusOne',
      'whiteboardOpenText',
    ],
    user: false,
    provenance: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': '3f4b581ef8f136ce1b2413a5548adb7cf852c5a9494c1b620a2e28d1e15328a0',
      },
    },
  },
  [PROMPT_IDS.CLASSROOM_DISCUSSION_PARTICIPANT]: {
    id: PROMPT_IDS.CLASSROOM_DISCUSSION_PARTICIPANT,
    variables: [
      'agentName',
      'persona',
      'roleGuideline',
      'peerContext',
      'languageConstraint',
      'stateContext',
      'chalkboardState',
      'chalkboardGuidelines',
      'discussionContextSection',
      'lengthGuidelines',
    ],
    user: false,
    adaptedFrom: {
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      sourceFile: 'lib/prompts/templates/agent-system/system.md',
      sourceHash: '7da837b795d1d6bb6d3cbc029c3323ef2700384ddacf93ad8b1af4ab8e8ae63e',
      reason: 'Chalk now exposes the same interleaved text/action envelope and wb_* capabilities, but keeps its shorter discussion role and response guidance plus strict server-side action validation.',
    },
  },
} as const satisfies { [Id in PromptId]: PromptDefinition<Id> };

export const snippetRegistry = {
  'image-instructions': '8acf722ec46e57739a8d29f485e542e178295a0ffd8449c38555de7e0469068e',
  'video-instructions': '7e8f1ce6b4b0d680e65ca4a784544e6bdcdd1a659a72466a38c13f2a695e5b79',
  'media-safety-guidelines': '3affbe74b1621faa3fd4cec7587063fcbca374b07f13e91129c74cac8d4c611c',
  'json-output-rules': '05ba04da6ef247a4b87bfcad989faf7b58aefcba1ec7a94f972890c2c5aed616',
  'slide-image-instructions': '00ba082fb8cf2510bcdc6684e09478778c19b5a00bd6e2818208efa55590db0c',
  'slide-generated-image-instructions': 'aed6d0a9ab210562c61183ca29ed7a6635d9c423e8b59a20b59a0d491a8ca0f1',
  'slide-video-instructions': '9a232d6a42e70fc5ac89ec8a8a10420b9c4d5e062287dd3e424e5d9bd934c856',
} as const;

export type SnippetId = keyof typeof snippetRegistry;
