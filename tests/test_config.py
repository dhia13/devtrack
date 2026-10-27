import importlib

import pytest

from app import config


@pytest.fixture
def reload_config(monkeypatch):
    def load(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        return importlib.reload(config)
    yield load
    monkeypatch.undo()
    importlib.reload(config)


def test_values_are_parsed(reload_config):
    c = reload_config(DEVTRACK_ALLOWED_HOSTS=" a , b,,", DEVTRACK_GIT_AUTO_STATUS="off",
                      DEVTRACK_REPOS_HOST="D:\\Work\\", GITLAB_URL="https://git.example/")
    assert c.ALLOWED_HOSTS == ["a", "b"]
    assert c.GIT_AUTO_STATUS is False
    assert c.REPOS_HOST == "D:/Work" and c.GITLAB_URL == "https://git.example"
    c = reload_config(DEVTRACK_INVOICE_FROM="Me\\nTunis", DEVTRACK_ICS_ALERT="")
    assert c.INVOICE_FROM == "Me\nTunis" and c.ICS_ALERT == ""


@pytest.mark.parametrize("env", [{"DEVTRACK_BACKUP_KEEP": "lots"}, {"DEVTRACK_BACKUP_KEEP": "0"},
                                 {"DEVTRACK_GIT_SYNC_MINUTES": "-1"}, {"DEVTRACK_ICS_ALERT": "9am"},
                                 {"DEVTRACK_HOURLY_RATE": "-5"}])
def test_bad_values_name_the_setting(reload_config, env):
    with pytest.raises(RuntimeError, match=next(iter(env))):  # ConfigError, re-created by the reload
        reload_config(**env)
