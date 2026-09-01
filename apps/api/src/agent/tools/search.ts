/** Compatibility entrypoint; implementation lives in the feature folder. */
export {
  createSearchTool,
  createStaticSearchProvider,
  type SearchProvider,
  type SearchRequest,
  type SearchResult,
} from './search-learning-resources/tool';
export { SEARCH_LEARNING_RESOURCES_PROMPT } from './search-learning-resources/prompts';
