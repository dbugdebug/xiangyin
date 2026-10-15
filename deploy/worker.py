"""Cloudflare Python Worker entry point for the existing Flask API."""
import os

# These are non-secret runtime defaults. Secrets and Hyperdrive credentials
# are read from each request's workers.env binding instead.
os.environ['DB_MODE'] = 'postgres'
os.environ['CLOUDFLARE_WORKERS'] = '1'

from workers import wsgi
from app import app

Default = wsgi.entrypoint(app)
