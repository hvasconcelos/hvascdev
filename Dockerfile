# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies from the lockfile first so this layer is cached
# independently of source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Astro inlines PUBLIC_* into the static output at build time, so these have to
# be present here rather than at `docker run` — passing them to the runtime
# container would be too late to reach the HTML. Both are optional: without an
# ID the analytics tag is simply not emitted.
ARG PUBLIC_UMAMI_WEBSITE_ID
ARG PUBLIC_UMAMI_SRC
ENV PUBLIC_UMAMI_WEBSITE_ID=$PUBLIC_UMAMI_WEBSITE_ID
ENV PUBLIC_UMAMI_SRC=$PUBLIC_UMAMI_SRC

RUN npm run build

# ---------- serve ----------
FROM nginx:1.29-alpine AS runtime

# The site is fully static, so nginx just serves dist/.
COPY --from=build /app/dist /usr/share/nginx/html

# The official image runs envsubst over /etc/nginx/templates at startup, which
# is what makes PORT overridable — hosts like Cloud Run or Fly inject their own.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=8080

# /files/ is proxied out of a private Railway bucket, signed per request by
# this njs module. See the location block in nginx.conf.template.
COPY s3-signer.js /etc/nginx/njs/s3-signer.js

# Two things the signer needs, both of which are main-context directives and
# so cannot live in the template — that is included inside http{}:
#
#   - the njs module. The non-slim nginx:alpine image already ships
#     ngx_http_js_module.so; nothing loads it.
#   - the credentials. nginx strips every environment variable from its
#     workers except TZ, so process.env in njs sees nothing unless each name
#     is declared here. Naming an unset variable is harmless, which is what
#     lets the image run with no bucket at all.
#
# Prepended rather than rewritten, so the packaged nginx.conf stays whatever
# the base image says it is.
RUN printf '%s\n' \
      'load_module modules/ngx_http_js_module.so;' \
      'env BUCKET;' \
      'env ACCESS_KEY_ID;' \
      'env SECRET_ACCESS_KEY;' \
      'env REGION;' \
      'env ENDPOINT;' \
      'env S3_PATH_STYLE;' \
      > /tmp/nginx.conf \
    && cat /etc/nginx/nginx.conf >> /tmp/nginx.conf \
    && mv /tmp/nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider "http://127.0.0.1:${PORT}/" || exit 1

CMD ["nginx", "-g", "daemon off;"]
