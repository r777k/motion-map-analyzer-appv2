import os
import hashlib
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from contextlib import contextmanager

# Fetch the live Neon connection string securely from environment configurations
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/dbname")

# UPGRADED: Switch to ThreadedConnectionPool for multi-user async safety loops
try:
    connection_pool = ThreadedConnectionPool(1, 15, dsn=DATABASE_URL)
except Exception as e:
    print(f"CRITICAL: Failed to initialize Neon connection pool: {e}")
    connection_pool = None

@contextmanager
def get_db_cursor():
    """
    Context manager that lends a connection from the pool, tests its liveness 
    to absorb Neon serverless idle timeouts, and automatically heals broken states.
    """
    if not connection_pool:
        raise RuntimeError("Database pool is offline. Verify your DATABASE_URL configuration.")
    
    conn = connection_pool.getconn()
    is_broken = False
    
    # LIVENESS PORT FIREWALL CHECK
    try:
        if conn.closed == 0:
            # Pinch the wire with an ultra-lightweight ping statement
            with conn.cursor() as test_cur:
                test_cur.execute("SELECT 1;")
        else:
            is_broken = True
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        is_broken = True

    # AUTO-HEALING ENGINE
    if is_broken:
        try:
            # Tell the pool to close and completely discard this dead connection row
            connection_pool.putconn(conn, close=True)
        except Exception:
            pass
        
        # Instantiate a completely fresh on-the-fly connection to save the user request
        conn = psycopg2.connect(dsn=DATABASE_URL)
        is_standalone = True
    else:
        is_standalone = False

    try:
        with conn.cursor() as cursor:
            yield cursor
        conn.commit()
    except Exception as error:
        conn.rollback()
        raise error
    finally:
        # Clean cleanup containment boundaries
        if is_standalone:
            try:
                conn.close()
            except Exception:
                pass
        else:
            connection_pool.putconn(conn)

def blind_hash_string(input_string: str) -> str:
    """
    The Zero-Knowledge Engine. Applies a deterministic, one-way SHA-256 
    cryptographic hash to strip raw string profiles before database storage lookups.
    """
    normalized = input_string.strip().lower()
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()