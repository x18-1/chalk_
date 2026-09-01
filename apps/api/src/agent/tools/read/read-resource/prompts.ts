/** Model-facing usage guidance for read_resource. Keep this text in English. */
export const READ_RESOURCE_PROMPT =
  'Use read_resource to read a bounded text resource that is already authorized for this conversation. ' +
  'Request only the lines and bytes needed; continue with the returned cursor when more content is required. ' +
  'Do not use it to guess paths, access scenes, or bypass resource permissions.';
