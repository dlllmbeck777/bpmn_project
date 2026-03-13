from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(..., example="ok")
    service: str = Field(..., example="core-api")
    db: str = Field(..., example="connected")
    circuit_breakers: Dict[str, Any] = Field(default_factory=dict)


class StatusResponse(BaseModel):
    status: str = Field(..., example="created")
    id: Any = Field(None)


class LoginIn(BaseModel):
    username: str = Field(..., example="admin")
    password: str = Field(..., example="admin")


class LoginResponse(BaseModel):
    status: str = Field("ok", example="ok")
    username: str = Field(..., example="admin")
    role: str = Field(..., example="admin")
    api_key: str = Field("", example="admin-key")


class ListResponse(BaseModel):
    items: List[Dict[str, Any]]


class ServiceIn(BaseModel):
    id: str = Field(..., example="isoftpull")
    name: str = Field(..., example="iSoftPull")
    type: str = Field("connector", example="connector")
    base_url: str = Field(..., example="http://isoftpull:8101")
    health_path: str = Field("/health")
    enabled: bool = Field(True)
    timeout_ms: int = Field(10000, ge=1000, le=120000)
    retry_count: int = Field(2, ge=0, le=10)
    endpoint_path: str = Field("/api/process", example="/api/pull")
    meta: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"json_schema_extra": {"examples": [
        {
            "id": "isoftpull",
            "name": "iSoftPull",
            "type": "connector",
            "base_url": "http://isoftpull:8101",
            "endpoint_path": "/api/pull",
            "timeout_ms": 10000,
            "retry_count": 2,
            "enabled": True,
            "health_path": "/health",
            "meta": {},
        }
    ]}}


class ServiceOut(BaseModel):
    id: str
    name: str
    type: str
    base_url: str
    health_path: str
    enabled: bool
    timeout_ms: int
    retry_count: int
    endpoint_path: str
    meta: Any
    updated_at: Optional[str] = None


class RuleIn(BaseModel):
    name: str = Field(..., example="SME Loan -> Flowable")
    priority: int = Field(0, ge=0)
    condition_field: str = Field(..., example="product_type")
    condition_op: str = Field("eq", example="eq")
    condition_value: str = Field(..., example="loan")
    target_mode: str = Field("flowable", example="flowable")
    enabled: bool = Field(True)
    meta: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"json_schema_extra": {"examples": [
        {
            "name": "Loan products via Flowable",
            "priority": 10,
            "condition_field": "product_type",
            "condition_op": "eq",
            "condition_value": "loan",
            "target_mode": "flowable",
            "enabled": True,
            "meta": {},
        }
    ]}}


class StopFactorIn(BaseModel):
    name: str = Field(..., example="Min credit score")
    stage: str = Field("pre", example="post")
    check_type: str = Field("field_check")
    field_path: Optional[str] = Field(None, example="result.parsed_report.summary.credit_score")
    operator: str = Field("gte", example="gte")
    threshold: Optional[str] = Field(None, example="600")
    action_on_fail: str = Field("REJECT", example="REJECT")
    enabled: bool = Field(True)
    priority: int = Field(0, ge=0)
    meta: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"json_schema_extra": {"examples": [
        {
            "name": "Min credit score 600",
            "stage": "post",
            "check_type": "field_check",
            "field_path": "result.parsed_report.summary.credit_score",
            "operator": "gte",
            "threshold": "600",
            "action_on_fail": "REJECT",
            "enabled": True,
            "priority": 10,
            "meta": {},
        }
    ]}}


class PipelineStepIn(BaseModel):
    pipeline_name: str = Field("default")
    step_order: int = Field(..., ge=1, example=1)
    service_id: str = Field(..., example="isoftpull")
    enabled: bool = Field(True)
    meta: Dict[str, Any] = Field(default_factory=dict)


class RequestIn(BaseModel):
    request_id: str = Field(..., example="REQ-2026-0001")
    customer_id: str = Field(..., example="CUST-001")
    iin: str = Field(..., example="900101123456")
    product_type: str = Field(..., example="loan")
    orchestration_mode: str = Field("auto", example="auto")
    payload: Dict[str, Any] = Field(default_factory=dict, example={"amount": 5000, "currency": "USD"})

    model_config = {"json_schema_extra": {"examples": [
        {
            "request_id": "REQ-2026-0001",
            "customer_id": "CUST-001",
            "iin": "900101123456",
            "product_type": "loan",
            "orchestration_mode": "auto",
            "payload": {"amount": 5000},
        }
    ]}}


class RequestResponse(BaseModel):
    request_id: str = Field(..., example="REQ-2026-0001")
    selected_mode: str = Field(..., example="flowable")
    result: Dict[str, Any] = Field(...)


class RequestRejectedResponse(BaseModel):
    request_id: str = Field(..., example="REQ-2026-0001")
    status: str = Field("REJECTED", example="REJECTED")
    reason: Optional[str] = Field(None, example="Failed: Min credit score")


class StopFactorResult(BaseModel):
    decision: str = Field(..., example="PASS")
    reason: str = Field(..., example="all checks passed")
    rule_id: Optional[int] = None
