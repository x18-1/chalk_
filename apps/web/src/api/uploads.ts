import { apiJson } from './client';

export const uploadsApi = {
  presign(input: { conversationId: string; filename: string; contentType: string; size: number }) {
    return apiJson<{ attachmentId: string; uploadUrl: string }>('/uploads/presign', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async upload(uploadUrl: string, file: File, contentType: string) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
    if (!response.ok) throw new Error('文件上传失败');
  },

  confirm(attachmentId: string) {
    return apiJson<{ attachment: { id: string } }>('/uploads/confirm', {
      method: 'POST',
      body: JSON.stringify({ attachmentId }),
    });
  },
};
