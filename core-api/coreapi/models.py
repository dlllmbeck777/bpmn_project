from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, model_validator


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


class AdminUserCreateIn(BaseModel):
    username: str = Field(..., example="analyst_1")
    display_name: str = Field("", example="Aigerim")
    role: str = Field("analyst", example="analyst")
    password: str = Field(..., min_length=4, example="change-me")
    enabled: bool = Field(True)


class AdminUserUpdateIn(BaseModel):
    display_name: str = Field("", example="Aigerim")
    role: str = Field("analyst", example="senior_analyst")
    password: Optional[str] = Field(None, min_length=4, example="new-password")
    enabled: bool = Field(True)


class FlowableActionIn(BaseModel):
    reason: str = Field("", example="Manual operational action from Flowable Ops")


class RequestActionIn(BaseModel):
    reason: str = Field("", example="Temporary connector outage resolved")


class RequestNoteIn(BaseModel):
    note: str = Field(..., min_length=1, example="Vendor incident acknowledged, retry after 15 minutes")


class TrackerEventIn(BaseModel):
    request_id: str = Field(..., example="REQ-2026-0001")
    stage: str = Field(..., example="connector")
    direction: str = Field(..., example="OUT")
    title: str = Field(..., example="Dispatch to isoftpull")
    service_id: Optional[str] = Field(None, example="isoftpull")
    status: Optional[str] = Field(None, example="DISPATCHED")
    payload: Any = Field(default_factory=dict)


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


class ApplicantIn(BaseModel):
    firstName: str = Field(..., example="John")
    lastName: str = Field(..., example="Doe")
    address: str = Field(..., example="123 Main Street")
    city: str = Field(..., example="New York")
    state: str = Field(..., example="NY")
    zipCode: str = Field(..., example="10001")
    ssn: str = Field(..., example="123456789")
    dateOfBirth: str = Field(..., example="1985-06-15")
    email: str = Field(..., example="john@example.com")
    phone: str = Field(..., example="555-123-4567")

    model_config = {"json_schema_extra": {"examples": [
        {
            "firstName": "John",
            "lastName": "Doe",
            "address": "123 Main Street",
            "city": "New York",
            "state": "NY",
            "zipCode": "10001",
            "ssn": "123456789",
            "dateOfBirth": "1985-06-15",
            "email": "john@example.com",
            "phone": "555-123-4567",
        }
    ]}}


class ApplicantUpdateIn(BaseModel):
    firstName: Optional[str] = Field(None, example="John")
    lastName: Optional[str] = Field(None, example="Smith")
    address: Optional[str] = Field(None, example="456 Oak Avenue")
    city: Optional[str] = Field(None, example="Los Angeles")
    state: Optional[str] = Field(None, example="CA")
    zipCode: Optional[str] = Field(None, example="90001")
    ssn: Optional[str] = Field(None, example="123456789")
    dateOfBirth: Optional[str] = Field(None, example="1985-06-15")
    email: Optional[str] = Field(None, example="john@example.com")
    phone: Optional[str] = Field(None, example="555-123-4567")

    @model_validator(mode="after")
    def validate_has_updates(self):
        if not any(
            getattr(self, field_name) not in (None, "")
            for field_name in (
                "firstName",
                "lastName",
                "address",
                "city",
                "state",
                "zipCode",
                "ssn",
                "dateOfBirth",
                "email",
                "phone",
            )
        ):
            raise ValueError("at least one applicant field must be provided")
        return self


class RequestIn(BaseModel):
    firstName: Optional[str] = Field(None, example="John")
    lastName: Optional[str] = Field(None, example="Doe")
    address: Optional[str] = Field(None, example="123 Main Street")
    city: Optional[str] = Field(None, example="New York")
    state: Optional[str] = Field(None, example="NY")
    zipCode: Optional[str] = Field(None, example="10001")
    ssn: Optional[str] = Field(None, example="123456789")
    dateOfBirth: Optional[str] = Field(None, example="1985-06-15")
    email: Optional[str] = Field(None, example="john@example.com")
    phone: Optional[str] = Field(None, example="555-123-4567")
    request_id: Optional[str] = Field(None, example="REQ-2026-0001")
    customer_id: Optional[str] = Field(None, example="CUST-001")
    iin: Optional[str] = Field(None, example="900101123456")
    external_applicant_id: Optional[str] = Field(None, example="51")
    product_type: Optional[str] = Field(None, example="loan")
    orchestration_mode: str = Field("auto", example="auto")
    payload: Dict[str, Any] = Field(default_factory=dict, example={"amount": 5000, "currency": "USD"})

    @model_validator(mode="after")
    def validate_supported_contract(self):
        applicant_fields = (
            self.firstName,
            self.lastName,
            self.address,
            self.city,
            self.state,
            self.zipCode,
            self.ssn,
            self.dateOfBirth,
            self.email,
            self.phone,
        )
        legacy_fields = (self.request_id, self.customer_id, self.iin, self.product_type)

        if any(value not in (None, "") for value in applicant_fields):
            missing = [
                field_name
                for field_name in (
                    "firstName",
                    "lastName",
                    "address",
                    "city",
                    "state",
                    "zipCode",
                    "ssn",
                    "dateOfBirth",
                    "email",
                    "phone",
                )
                if getattr(self, field_name) in (None, "")
            ]
            if missing:
                raise ValueError(f"missing applicant fields: {', '.join(missing)}")
            return self

        if all(value not in (None, "") for value in legacy_fields):
            return self

        raise ValueError(
            "request body must be either Applicant Input v2 "
            "(firstName, lastName, address, city, state, zipCode, ssn, dateOfBirth, email, phone) "
            "or the legacy internal request contract"
        )

    model_config = {"json_schema_extra": {"examples": [
        {
            "firstName": "John",
            "lastName": "Doe",
            "address": "123 Main Street",
            "city": "New York",
            "state": "NY",
            "zipCode": "10001",
            "ssn": "123456789",
            "dateOfBirth": "1985-06-15",
            "email": "john@example.com",
            "phone": "555-123-4567",
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
