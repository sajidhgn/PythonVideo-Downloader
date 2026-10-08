from pydantic import BaseModel
from fastapi import FastAPI, HTTPException
import json

app = FastAPI()

with open("user_db.json", "r") as f:
    data = json.load(f)
    Users = data.get("Users", {})

class User(BaseModel):
    id: int
    name: str
    email: str
    is_active: bool = True

@app.get("/users/{user_id}")
def read_user(user_id: int):
    string_user_id = str(user_id) 
    if string_user_id not in Users:
        raise HTTPException(status_code=404, detail="User not found")
    return Users.get(string_user_id)

@app.get("/users/")
def read_users():
    return [user for user in Users.values()]