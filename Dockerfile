# Monorepo-root Dockerfile for Render (build context = repo root).
# Prefer this on Render: Root Directory empty, Dockerfile Path ./Dockerfile
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -o /server ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /server /app/server
COPY --from=build /src/migrations /app/migrations
ENV MIGRATIONS_DIR=/app/migrations
EXPOSE 8081
CMD ["/app/server"]
