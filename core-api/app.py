from coreapi.app_factory import app


if __name__ == "__main__":
    import os
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("CORE_PORT", "8000")))
