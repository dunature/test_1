FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir rqalpha pandas numpy
COPY runner.py /runner.py
WORKDIR /workspace
ENTRYPOINT ["python", "/runner.py"]
