FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    HF_HOME=/opt/huggingface \
    RERANK_MODEL_WARMUP=1

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv==0.6.14 \
    && uv sync --frozen --no-dev

# Bake the approved model into the image so the first user request does not
# depend on outbound Hugging Face access or pay the model-download cold start.
RUN uv run --no-dev python -c "from sentence_transformers import CrossEncoder; CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2', revision='233902d25c440f23af6f7d6e94d2946bac0bee0a')"

COPY app ./app

RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app /opt/huggingface
USER appuser

EXPOSE 8000
CMD ["uv", "run", "--no-dev", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
