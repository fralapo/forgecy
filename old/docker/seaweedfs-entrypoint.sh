#!/bin/sh
# Optional bundled S3 store (profile "s3"). Writes the S3 identity from the env and starts SeaweedFS.
set -eu
cat > /tmp/s3.json <<JSON
{"identities":[{"name":"forgecy","credentials":[{"accessKey":"${S3_ACCESS_KEY_ID}","secretKey":"${S3_SECRET_ACCESS_KEY}"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
JSON
exec weed server -dir=/data -s3 -s3.port=8333 -s3.config=/tmp/s3.json -master.volumeSizeLimitMB=1024 -volume.max=0
