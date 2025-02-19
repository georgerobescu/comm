// @flow

import * as React from 'react';

import type { UserListItem } from 'lib/types/user-types';

import css from './members-modal.css';

type AddMembersItemProps = {
  +userInfo: UserListItem,
  +onClick: (userID: string) => void,
  +userAdded: boolean,
};

function AddMemberItem(props: AddMembersItemProps): React.Node {
  const { userInfo, onClick, userAdded = false } = props;

  const canBeAdded = !userInfo.alertText;

  const onClickCallback = React.useCallback(() => {
    if (!canBeAdded) {
      return;
    }
    onClick(userInfo.id);
  }, [canBeAdded, onClick, userInfo.id]);

  const action = React.useMemo(() => {
    if (!canBeAdded) {
      return userInfo.alertTitle;
    }
    if (userAdded) {
      return <span className={css.danger}>Remove</span>;
    } else {
      return 'Add';
    }
  }, [canBeAdded, userAdded, userInfo.alertTitle]);

  return (
    <button
      className={css.addMemberItem}
      onClick={onClickCallback}
      disabled={!canBeAdded}
    >
      <div className={css.label}>{userInfo.username}</div>
      <div className={css.label}>{action}</div>
    </button>
  );
}

export default AddMemberItem;
