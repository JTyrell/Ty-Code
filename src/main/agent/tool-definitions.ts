/**
 * Ty-Code AI Agent Tool Definitions
 *
 * Defines the schemas and parameters for all tools exposed to the AI harness.
 * Includes the privacy-first Brave Web Search tool running in isolated Guest Mode.
 *
 * Brand: Ty-Code
 */

export interface ToolDefinitionParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  items?: {
    type: string;
    description?: string;
    properties?: Record<string, any>;
  };
}

export interface AgentToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolDefinitionParameterProperty>;
      required?: string[];
    };
  };
}

/**
 * Brave Web Search Tool Definition
 * Executes a web search via the ephemeral Brave Guest Mode engine.
 * Isolates all cookies, search history, and credentials.
 */
export const BRAVE_WEB_SEARCH_TOOL: AgentToolSchema = {
  type: 'function',
  function: {
    name: 'brave_web_search',
    description:
      'Search the web for up-to-date documentation, APIs, error solutions, or library guides using an isolated, ephemeral Brave Browser Guest session. Extracts the top 3 results and returns their titles, URLs, and text snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query or keywords to look up on the web.'
        }
      },
      required: ['query']
    }
  }
};

/**
 * Submit Plan Tool Definition
 * Pushes an execution plan out of the chat sidecar and into the main editor window.
 */
export const SUBMIT_PLAN_TOOL: AgentToolSchema = {
  type: 'function',
  function: {
    name: 'submit_plan',
    description:
      'Submit an execution plan as a first-class interactive document in the editor. Use this whenever delivering an implementation plan or multi-step execution proposal instead of pasting raw markdown into chat.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the execution plan.'
        },
        markdown: {
          type: 'string',
          description: 'Complete markdown of the plan structured with ATX headings (#, ##, ###).'
        }
      },
      required: ['title', 'markdown']
    }
  }
};

/**
 * Submit Report Tool Definition
 * Pushes an analysis or review report out of the chat sidecar and into the main editor window.
 */
export const SUBMIT_REPORT_TOOL: AgentToolSchema = {
  type: 'function',
  function: {
    name: 'submit_report',
    description:
      'Submit an analysis, audit, research, or diagnostic report as a first-class interactive document in the editor. Use this whenever delivering an analysis report or review instead of pasting raw markdown into chat.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the report.'
        },
        markdown: {
          type: 'string',
          description: 'Complete markdown of the report structured with ATX headings (#, ##, ###).'
        }
      },
      required: ['title', 'markdown']
    }
  }
};

export { AGENT_TOOLS_DEFINITIONS } from './system-prompt';

