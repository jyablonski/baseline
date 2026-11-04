# syntax=docker/dockerfile:1.28.0
# cubejs/cube:v1.7+ publishes linux/amd64 and linux/arm64. Do not pin platform.
# (Cube Store, if added later, is a separate image and is not multi-arch.)

FROM cubejs/cube:v1.8.14 AS runtime
WORKDIR /cube/conf
COPY cube.js ./cube.js
COPY model ./model

FROM runtime AS development
WORKDIR /cube/conf
