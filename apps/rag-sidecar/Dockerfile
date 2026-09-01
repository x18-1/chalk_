FROM python:3.13-slim

WORKDIR /app
COPY pyproject.toml ./
COPY chalk_rag_sidecar ./chalk_rag_sidecar
RUN pip install --no-cache-dir .

# Containers need to accept requests from the API container. Deploy this image
# on a private network; do not publish port 8010 to the public internet.
ENV RAG_HOST=0.0.0.0 RAG_PORT=8010
EXPOSE 8010
CMD ["chalk-rag-sidecar"]
