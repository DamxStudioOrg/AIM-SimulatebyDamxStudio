FROM python:3.13-slim

WORKDIR /app
RUN useradd -m appuser
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir ".[api]" && chown -R appuser:appuser /app

USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/contract')"
CMD ["uvicorn", "aim_sim.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
