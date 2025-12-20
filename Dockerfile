FROM docker.io/cloudflare/sandbox:0.6.6

COPY scripts/init.sh /usr/local/bin/init.sh
RUN chmod +x /usr/local/bin/init.sh

RUN npm install -g @anthropic-ai/claude-code
ENV COMMAND_TIMEOUT_MS=300000
EXPOSE 3000
EXPOSE 8080

