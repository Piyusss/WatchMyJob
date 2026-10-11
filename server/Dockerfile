# Build: compile the server into one static binary (companies.json, the
# migrations and the email template are embedded in it).
FROM golang:1.27-alpine AS build
WORKDIR /src
# Dependencies get their own layer, so a code-only change doesn't download
# them all again.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /server .

# Run: only the binary, on a minimal image with no shell, as a non-root user.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /server /server
# 4000: the API. 9091: the metrics Prometheus reads (keep it private).
EXPOSE 4000 9091
ENTRYPOINT ["/server"]
