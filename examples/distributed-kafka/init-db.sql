-- xcomponent-ai FSM Database Schema (Kafka Example)
-- This script is executed when PostgreSQL container starts

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- FSM Events Table (Event Sourcing)
CREATE TABLE IF NOT EXISTS fsm_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instance_id UUID NOT NULL,
    machine_name VARCHAR(255) NOT NULL,
    component_name VARCHAR(255),
    event_type VARCHAR(255) NOT NULL,
    event_payload JSONB DEFAULT '{}',
    from_state VARCHAR(255),
    to_state VARCHAR(255),
    context JSONB DEFAULT '{}',
    public_member_snapshot JSONB,
    source_component_name VARCHAR(255),
    correlation_id UUID,
    causation_id UUID,
    caused JSONB DEFAULT '[]',
    persisted_at BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migrate existing tables: add columns that may be missing from older schemas
ALTER TABLE fsm_events ADD COLUMN IF NOT EXISTS component_name VARCHAR(255);
ALTER TABLE fsm_events ADD COLUMN IF NOT EXISTS source_component_name VARCHAR(255);

-- Indexes for FSM Events
CREATE INDEX IF NOT EXISTS idx_fsm_events_instance_id ON fsm_events(instance_id);
CREATE INDEX IF NOT EXISTS idx_fsm_events_persisted_at ON fsm_events(persisted_at);
CREATE INDEX IF NOT EXISTS idx_fsm_events_correlation_id ON fsm_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_fsm_events_machine_name ON fsm_events(machine_name);
CREATE INDEX IF NOT EXISTS idx_fsm_events_event_type ON fsm_events(event_type);

-- FSM Snapshots Table
CREATE TABLE IF NOT EXISTS fsm_snapshots (
    instance_id UUID PRIMARY KEY,
    machine_name VARCHAR(255) NOT NULL,
    current_state VARCHAR(255) NOT NULL,
    context JSONB DEFAULT '{}',
    event_count INTEGER DEFAULT 0,
    pending_timeouts JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for FSM Snapshots
CREATE INDEX IF NOT EXISTS idx_fsm_snapshots_machine_name ON fsm_snapshots(machine_name);
CREATE INDEX IF NOT EXISTS idx_fsm_snapshots_current_state ON fsm_snapshots(current_state);
CREATE INDEX IF NOT EXISTS idx_fsm_snapshots_updated_at ON fsm_snapshots(updated_at);

-- Useful views

-- Active instances view
CREATE OR REPLACE VIEW active_instances AS
SELECT
    s.instance_id,
    s.machine_name,
    s.current_state,
    s.context,
    s.pending_timeouts,
    s.created_at,
    s.updated_at,
    (SELECT COUNT(*) FROM fsm_events e WHERE e.instance_id = s.instance_id) as total_events
FROM fsm_snapshots s
WHERE s.current_state NOT IN (
    SELECT DISTINCT to_state FROM fsm_events
    WHERE to_state IS NOT NULL
    GROUP BY to_state
    HAVING COUNT(*) > 0
);

-- Event history view with readable format
CREATE OR REPLACE VIEW event_history AS
SELECT
    e.id,
    e.instance_id,
    e.machine_name,
    e.component_name,
    e.event_type,
    e.from_state,
    e.to_state,
    e.event_payload,
    e.context,
    e.public_member_snapshot,
    e.source_component_name,
    to_timestamp(e.persisted_at / 1000) as event_time,
    e.correlation_id,
    e.causation_id
FROM fsm_events e
ORDER BY e.persisted_at DESC;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO xcomponent;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO xcomponent;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'xcomponent-ai FSM database schema initialized successfully (Kafka example)';
END $$;
