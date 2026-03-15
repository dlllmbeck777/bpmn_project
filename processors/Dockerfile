FROM python:3.12-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py .
COPY start.sh .
RUN chmod +x start.sh
EXPOSE 8105 8106
CMD ["./start.sh"]
