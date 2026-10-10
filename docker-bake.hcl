# Multi-platform bake file. Keep service contexts in sync with docker-compose.yml.
# Native-arch local builds: `make build` (Compose, host CPU only).
# Both ISAs: `make build-multiarch` (needs a docker-container buildx builder;
# qemu/binfmt for the non-native arch).
#
#   make build-multiarch
#   make build-multiarch PUSH=1 IMAGE_PREFIX=ghcr.io/example/

variable "DOCKER_TARGET" {
  default = "runtime"
}

variable "PLATFORMS" {
  default = "linux/amd64,linux/arm64"
}

variable "IMAGE_PREFIX" {
  default = ""
}

variable "IMAGE_TAG" {
  default = "latest"
}

variable "NEXT_PUBLIC_API_URL" {
  default = "http://localhost:8000"
}

# Shown on /about so a running deploy can be tied back to a commit. CI sets this
# to the same sha it tags images with; local builds fall back to "dev".
variable "GIT_SHA" {
  default = "dev"
}

# Registry builds also move `:latest` so `make prod-pull` has a default tag;
# the immutable `:<sha>` tag is what a deploy (and a rollback) pins.
function "tags" {
  params = [name]
  result = equal(IMAGE_PREFIX, "") ? ["${name}:${IMAGE_TAG}"] : (
    equal(IMAGE_TAG, "latest")
    ? ["${IMAGE_PREFIX}${name}:latest"]
    : ["${IMAGE_PREFIX}${name}:${IMAGE_TAG}", "${IMAGE_PREFIX}${name}:latest"]
  )
}

group "default" {
  targets = ["api", "frontend", "scraper", "dbt", "ml", "mcp", "cube", "migrate"]
}

# What docker-compose.prod.yml actually runs. CI builds only this group.
group "prod" {
  targets = ["api", "frontend", "migrate", "mcp", "cube", "scraper", "dbt", "ml"]
}

target "_common" {
  dockerfile = "Dockerfile"
  target     = DOCKER_TARGET
  platforms  = split(",", PLATFORMS)
}

target "migrate" {
  inherits = ["_common"]
  context  = "./services/migrate"
  tags     = tags("nba-migrate")
}

target "api" {
  inherits = ["_common"]
  # Repo root: the image also needs lib/baseline-analytics.
  context    = "."
  dockerfile = "services/api/Dockerfile"
  tags       = tags("nba-api")
}

target "frontend" {
  inherits = ["_common"]
  context  = "./services/frontend"
  tags     = tags("nba-frontend")
  args = {
    NEXT_PUBLIC_API_URL = NEXT_PUBLIC_API_URL
    NEXT_PUBLIC_GIT_SHA = GIT_SHA
  }
}

target "scraper" {
  inherits = ["_common"]
  context  = "./services/scraper"
  tags     = tags("nba-scraper")
}

target "dbt" {
  inherits = ["_common"]
  context  = "./services/dbt"
  tags     = tags("nba-dbt")
}

target "ml" {
  inherits = ["_common"]
  context  = "./services/ml"
  tags     = tags("nba-ml")
}

target "mcp" {
  inherits = ["_common"]
  # Repo root: the image also needs lib/baseline-analytics.
  context    = "."
  dockerfile = "services/mcp/Dockerfile"
  tags       = tags("nba-mcp")
}

target "cube" {
  inherits = ["_common"]
  context  = "./services/cube"
  tags     = tags("nba-cube")
}
