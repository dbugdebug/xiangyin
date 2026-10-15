"""Cloudflare Python Workers WSGI entry point."""
from workers import wsgi
from app import app

Default = wsgi.entrypoint(app)
