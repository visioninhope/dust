#!/bin/sh

export DD_ENV=development
export DD_SERVICE=front
export NODE_OPTIONS='-r dd-trace/init'
export DD_LOGS_INJECTION=true
export DD_RUNTIME_METRICS_ENABLED=true
export NODE_ENV=development

npm run dev
